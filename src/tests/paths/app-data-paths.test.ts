import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const userDataRoot = path.join(os.tmpdir(), 'lygodactylus-app-data-test');

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return userDataRoot;
      if (name === 'home') return path.join(os.tmpdir(), 'home');
      return path.join(os.tmpdir(), name);
    },
  },
}));

describe('app-data-paths', () => {
  beforeEach(() => {
    vi.resetModules();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
    fs.mkdirSync(userDataRoot, { recursive: true });
  });

  it('migrates legacy userData/claude/skills to userData/skills', async () => {
    const legacySkills = path.join(userDataRoot, 'claude', 'skills', 'alpha');
    fs.mkdirSync(legacySkills, { recursive: true });
    fs.writeFileSync(path.join(legacySkills, 'SKILL.md'), '# alpha');

    const { migrateLegacyAgentDataPaths, getRuntimeSkillsDir } = await import(
      '../../main/paths/app-data-paths'
    );
    migrateLegacyAgentDataPaths();

    const runtimeSkills = getRuntimeSkillsDir();
    expect(fs.existsSync(path.join(runtimeSkills, 'alpha', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(userDataRoot, 'claude', 'skills'))).toBe(false);
  });

  it('migrates legacy userData/claude/plugins to userData/plugins', async () => {
    const legacyPlugins = path.join(userDataRoot, 'claude', 'plugins', 'source', 'demo');
    fs.mkdirSync(legacyPlugins, { recursive: true });
    fs.writeFileSync(path.join(legacyPlugins, 'marker.txt'), 'ok');

    const { migrateLegacyAgentDataPaths, getPluginsRootPath } = await import(
      '../../main/paths/app-data-paths'
    );
    migrateLegacyAgentDataPaths();

    expect(fs.existsSync(path.join(getPluginsRootPath(), 'source', 'demo', 'marker.txt'))).toBe(
      true
    );
  });
});
