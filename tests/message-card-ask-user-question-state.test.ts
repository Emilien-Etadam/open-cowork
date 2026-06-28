import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const messageCardPath = path.resolve(process.cwd(), 'src/renderer/components/MessageCard.tsx');
const messageDir = path.resolve(process.cwd(), 'src/renderer/components/message');
const messageCardContent = [
  fs.readFileSync(messageCardPath, 'utf8'),
  ...fs.readdirSync(messageDir).map((f) => fs.readFileSync(path.join(messageDir, f), 'utf8')),
].join('\n');

describe('AskUserQuestion UI rendering', () => {
  it('renders AskUserQuestionBlock with interactive submit flow when pending', () => {
    expect(messageCardContent).toContain('function AskUserQuestionBlock');
    expect(messageCardContent).toContain('respondToQuestion');
    expect(messageCardContent).toContain('pendingQuestion');
    expect(messageCardContent).toContain('handleSubmit');
  });

  it('still renders question options for display', () => {
    expect(messageCardContent).toContain('getOptionLetter');
    expect(messageCardContent).toContain('QuestionItem');
  });
});
