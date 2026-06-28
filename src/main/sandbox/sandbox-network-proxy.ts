/**
 * Forward HTTP/HTTPS proxy on the Windows host so WSL sandbox shells can reach
 * LAN services (192.168.x.x, etc.) through the host network stack.
 */
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { log, logError } from '../utils/logger';

const execFileAsync = promisify(execFile);

function validateDistroName(distro: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(distro)) {
    throw new Error(`Invalid WSL distro name: ${distro}`);
  }
  return distro;
}

export async function getWslWindowsHostIp(distro: string): Promise<string | null> {
  const safeDistro = validateDistroName(distro);
  try {
    const { stdout } = await execFileAsync(
      'wsl',
      [
        '-d',
        safeDistro,
        '-e',
        'bash',
        '-lc',
        "grep -m1 nameserver /etc/resolv.conf | awk '{print $2}'",
      ],
      { windowsHide: true, timeout: 10_000 }
    );
    const ip = stdout.trim();
    return ip || null;
  } catch (error) {
    logError('[SandboxNetworkProxy] Failed to resolve WSL Windows host IP:', error);
    return null;
  }
}

function writeProxyError(res: http.ServerResponse, status: number, message: string): void {
  if (res.headersSent) {
    return;
  }
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}

export class SandboxNetworkProxy {
  private server: http.Server | null = null;
  private listenHost: string | null = null;
  private port = 0;
  private refCount = 0;

  getPort(): number {
    return this.port;
  }

  getListenHost(): string | null {
    return this.listenHost;
  }

  getProxyUrl(): string | null {
    if (!this.listenHost || !this.port) {
      return null;
    }
    return `http://${this.listenHost}:${this.port}`;
  }

  async acquire(distro: string): Promise<string | null> {
    this.refCount += 1;
    if (this.server?.listening) {
      return this.getProxyUrl();
    }

    const hostIp = await getWslWindowsHostIp(distro);
    if (!hostIp) {
      this.refCount = Math.max(0, this.refCount - 1);
      return null;
    }

    await this.start(hostIp);
    return this.getProxyUrl();
  }

  async release(): Promise<void> {
    this.refCount = Math.max(0, this.refCount - 1);
    if (this.refCount === 0) {
      await this.stop();
    }
  }

  private async start(hostIp: string): Promise<void> {
    if (this.server?.listening) {
      return;
    }

    const server = http.createServer((req, res) => {
      void this.handleHttpRequest(req, res);
    });
    server.on('connect', (req, clientSocket, head) => {
      this.handleConnect(req, clientSocket, head);
    });
    server.on('error', (error) => {
      logError('[SandboxNetworkProxy] Server error:', error);
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, hostIp, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });

    const address = server.address();
    this.port = typeof address === 'object' && address ? address.port : 0;
    this.listenHost = hostIp;
    this.server = server;
    log(`[SandboxNetworkProxy] Listening on ${hostIp}:${this.port} for WSL sandbox traffic`);
  }

  private async handleHttpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const targetUrl = req.url?.trim();
    if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
      writeProxyError(res, 400, 'Absolute http/https URL required');
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      writeProxyError(res, 400, 'Invalid target URL');
      return;
    }

    const headers = { ...req.headers };
    delete headers.host;
    delete headers.connection;
    delete headers['proxy-connection'];

    const requestFn = parsed.protocol === 'https:' ? https.request : http.request;
    const proxyReq = requestFn(
      parsed,
      {
        method: req.method,
        headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );

    proxyReq.on('error', (error) => {
      writeProxyError(res, 502, error.message);
    });

    req.pipe(proxyReq);
  }

  private handleConnect(req: http.IncomingMessage, clientSocket: net.Socket, head: Buffer): void {
    const target = req.url?.trim();
    if (!target) {
      clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }

    const [host, portText] = target.split(':');
    const port = Number.parseInt(portText || '443', 10);
    if (!host || !Number.isFinite(port)) {
      clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }

    const serverSocket = net.connect(port, host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) {
        serverSocket.write(head);
      }
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });

    serverSocket.on('error', () => {
      clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    });
    clientSocket.on('error', () => {
      serverSocket.destroy();
    });
  }

  private async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.port = 0;
    this.listenHost = null;
    if (!server) {
      return;
    }

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    log('[SandboxNetworkProxy] Stopped');
  }
}

let sharedProxy: SandboxNetworkProxy | null = null;

export function getSandboxNetworkProxy(): SandboxNetworkProxy {
  if (!sharedProxy) {
    sharedProxy = new SandboxNetworkProxy();
  }
  return sharedProxy;
}

/** @internal Test helper */
export function resetSandboxNetworkProxyForTests(): void {
  sharedProxy = null;
}
