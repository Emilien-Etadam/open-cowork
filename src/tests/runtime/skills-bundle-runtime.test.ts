import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getAppPath: () => '/tmp/lygodactylus-app',
    getVersion: () => '5.4.0',
    getPath: (name: string) => {
      if (name === 'userData') {
        return '/tmp/lygodactylus-userdata';
      }
      return `/tmp/lygodactylus-${name}`;
    },
  },
}));

describe('skills-bundle-runtime', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('detects legacy bundled heavy skills under resourcesPath', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-bundle-legacy-'));
    const legacyRoot = path.join(tmp, 'skills');
    fs.mkdirSync(path.join(legacyRoot, 'docx'), { recursive: true });
    fs.writeFileSync(path.join(legacyRoot, 'docx', 'SKILL.md'), '# docx');

    const originalResourcesPath = (process as NodeJS.Process & { resourcesPath?: string })
      .resourcesPath;
    Object.defineProperty(process, 'resourcesPath', {
      value: tmp,
      configurable: true,
    });

    const { getLegacyBundledSkillsRoot } = await import('../../main/skills/builtin-skills-paths');
    expect(getLegacyBundledSkillsRoot()).toBe(legacyRoot);

    Object.defineProperty(process, 'resourcesPath', {
      value: originalResourcesPath,
      configurable: true,
    });
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('reports heavy skills not ready when on-demand cache is empty', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-bundle-empty-'));
    Object.defineProperty(process, 'resourcesPath', {
      value: tmp,
      configurable: true,
    });

    const { isHeavySkillReady, getHeavySkillsStatus, clearSkillsBundleCache } =
      await import('../../main/runtime/skills-bundle-runtime');
    clearSkillsBundleCache();
    expect(isHeavySkillReady('docx')).toBe(false);
    expect(isHeavySkillReady('pdf')).toBe(true);

    const status = getHeavySkillsStatus();
    expect(status.ready).toBe(false);
    expect(status.pending).toContain('docx');
    expect(status.pending).toContain('pptx');

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('copies heavy skill from dev source without network', async () => {
    const projectRoot = path.resolve(__dirname, '../../..');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-bundle-dev-'));
    const userData = path.join(tmp, 'userdata');
    fs.mkdirSync(userData, { recursive: true });

    vi.doMock('electron', () => ({
      app: {
        isPackaged: false,
        getAppPath: () => projectRoot,
        getVersion: () => '5.4.0',
        getPath: (name: string) => (name === 'userData' ? userData : path.join(tmp, name)),
      },
    }));

    const { ensureHeavySkill, clearSkillsBundleCache } =
      await import('../../main/runtime/skills-bundle-runtime');
    clearSkillsBundleCache();

    const skillPath = await ensureHeavySkill('docx');
    expect(fs.existsSync(path.join(skillPath, 'SKILL.md'))).toBe(true);

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
