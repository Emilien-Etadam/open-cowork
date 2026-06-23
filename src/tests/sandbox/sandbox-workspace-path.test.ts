import { describe, expect, it } from 'vitest';
import {
  resolveSandboxBashCwd,
  rewriteVirtualWorkspacePaths,
  shellEscapePosixPath,
  wslUncPathToUnix,
  wslUnixPathToWindowsUnc,
} from '../../main/sandbox/sandbox-workspace-path';

describe('sandbox workspace path helpers', () => {
  const sandboxPath = '/home/ubuntu/.claude/sandbox/session-1';

  it('converts WSL unix paths to Windows UNC paths', () => {
    expect(wslUnixPathToWindowsUnc('Ubuntu-24.04', sandboxPath)).toBe(
      '\\\\wsl.localhost\\Ubuntu-24.04\\home\\ubuntu\\.claude\\sandbox\\session-1'
    );
  });

  it('converts Windows UNC paths back to unix paths', () => {
    expect(
      wslUncPathToUnix('\\\\wsl.localhost\\Ubuntu-24.04\\home\\ubuntu\\.claude\\sandbox\\session-1')
    ).toBe(sandboxPath);
  });

  it('rewrites virtual /workspace references in shell commands', () => {
    expect(rewriteVirtualWorkspacePaths('ls /workspace && cat /workspace/a.txt', sandboxPath)).toBe(
      `ls ${sandboxPath} && cat ${sandboxPath}/a.txt`
    );
  });

  it('maps virtual cwd values to the sandbox root', () => {
    expect(resolveSandboxBashCwd('/workspace', sandboxPath)).toBe(sandboxPath);
    expect(resolveSandboxBashCwd('/workspace/src', sandboxPath)).toBe(`${sandboxPath}/src`);
    expect(
      resolveSandboxBashCwd(
        '\\\\wsl.localhost\\Ubuntu-24.04\\home\\ubuntu\\.claude\\sandbox\\session-1',
        sandboxPath
      )
    ).toBe(sandboxPath);
  });

  it('escapes posix shell paths safely', () => {
    expect(shellEscapePosixPath("/tmp/o'reilly")).toBe("/tmp/o'\\''reilly");
  });
});
