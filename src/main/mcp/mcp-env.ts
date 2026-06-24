import path from 'path';

export function normalizeWindowsPathForComparison(candidate: string): string {
  return path.win32.normalize(candidate).replace(/\//g, '\\').toLowerCase();
}

export function normalizeWindowsDirectoryForComparison(candidate: string): string {
  return normalizeWindowsPathForComparison(candidate).replace(/[\\/]+$/, '');
}

function hasNonEmptyEnvValue(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function isProtectedConfigEnvKey(key: string): boolean {
  return (
    key.startsWith('OPENAI_') ||
    key.startsWith('ANTHROPIC_') ||
    key.startsWith('CLAUDE_') ||
    key.startsWith('COWORK_')
  );
}

export function mergeShellEnvForMcp(
  baseEnv: Record<string, string>,
  shellEnv: Record<string, string>
): Record<string, string> {
  const merged = { ...baseEnv };
  for (const [key, value] of Object.entries(shellEnv)) {
    if (key === 'PATH') {
      continue;
    }
    if (isProtectedConfigEnvKey(key)) {
      continue;
    }
    if (hasNonEmptyEnvValue(merged[key])) {
      continue;
    }
    if (typeof value === 'string' && value.length > 0) {
      merged[key] = value;
    }
  }
  return merged;
}

export function getTrustedWindowsNpxDirectories(
  env: Record<string, string | undefined> = process.env
): string[] {
  const candidates = [env.ProgramW6432, env.ProgramFiles, env['ProgramFiles(x86)']].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0
  );

  return Array.from(
    new Set(
      candidates.map((directory) =>
        normalizeWindowsDirectoryForComparison(path.win32.join(directory, 'nodejs'))
      )
    )
  );
}

export function findPreferredWindowsNpxPath(
  pathEnv: string | undefined,
  bundledNpxPath: string | null,
  pathExists: (candidate: string) => boolean = (candidate) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    return fs.existsSync(candidate);
  },
  trustedDirectories?: string[]
): string | null {
  const bundledNormalized = bundledNpxPath
    ? normalizeWindowsPathForComparison(bundledNpxPath)
    : null;
  const normalizedTrustedDirectories = trustedDirectories?.map(
    normalizeWindowsDirectoryForComparison
  );

  for (const rawEntry of (pathEnv || '').split(';')) {
    const entry = rawEntry.trim().replace(/^"(.*)"$/, '$1');
    if (!entry) {
      continue;
    }

    const candidate = path.win32.join(entry, 'npx.cmd');
    if (!pathExists(candidate)) {
      continue;
    }

    if (bundledNormalized && normalizeWindowsPathForComparison(candidate) === bundledNormalized) {
      continue;
    }

    if (
      normalizedTrustedDirectories &&
      !normalizedTrustedDirectories.includes(normalizeWindowsDirectoryForComparison(entry))
    ) {
      continue;
    }

    return candidate;
  }

  return bundledNpxPath;
}
