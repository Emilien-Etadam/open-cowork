import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const panelPath = path.resolve('src/renderer/components/RemoteControlPanel.tsx');
const panelContent = fs.readFileSync(panelPath, 'utf8');

describe('RemoteControlPanel links', () => {
  it('does not reference Feishu integration', () => {
    expect(panelContent).not.toContain('FeishuConfigStep');
    expect(panelContent).not.toContain('open.feishu.cn');
    expect(panelContent).not.toContain('updateFeishuConfig');
  });

  it('uses Slack remote configuration', () => {
    expect(panelContent).toContain('SlackConfigStep');
    expect(panelContent).toContain('updateSlackConfig');
  });
});
