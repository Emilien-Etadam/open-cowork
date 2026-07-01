import { describe, expect, it } from 'vitest';
import {
  LONG_PASTE_CHAR_THRESHOLD,
  LONG_PASTE_LINE_THRESHOLD,
  LONG_PASTE_MAX_BYTES,
  countTextNoteLines,
  createTextNoteAttachment,
  formatAttachmentSize,
  getTextByteSize,
  isTextNoteFilename,
  shouldConvertLongPaste,
} from '../../src/shared/long-paste';

describe('long-paste', () => {
  it('does not convert empty or short text', () => {
    expect(shouldConvertLongPaste('')).toBe(false);
    expect(shouldConvertLongPaste('   ')).toBe(false);
    expect(shouldConvertLongPaste('a'.repeat(LONG_PASTE_CHAR_THRESHOLD - 1))).toBe(false);
    expect(shouldConvertLongPaste('line\n'.repeat(LONG_PASTE_LINE_THRESHOLD - 1))).toBe(false);
  });

  it('converts when char threshold is reached', () => {
    expect(shouldConvertLongPaste('a'.repeat(LONG_PASTE_CHAR_THRESHOLD))).toBe(true);
  });

  it('converts when line threshold is reached', () => {
    expect(shouldConvertLongPaste('x\n'.repeat(LONG_PASTE_LINE_THRESHOLD))).toBe(true);
  });

  it('counts lines across Windows and Unix newlines', () => {
    expect(countTextNoteLines('a\r\nb\rc')).toBe(3);
    expect(countTextNoteLines('single')).toBe(1);
  });

  it('creates a text note attachment with stable naming and base64 payload', () => {
    const note = createTextNoteAttachment('hello world', 2);
    expect(note.name).toBe('pasted-note-2.txt');
    expect(note.isTextNote).toBe(true);
    expect(note.type).toBe('text/plain');
    expect(note.size).toBe(getTextByteSize('hello world'));
    expect(note.inlineDataBase64).toBe(Buffer.from('hello world', 'utf8').toString('base64'));
  });

  it('rejects oversized pasted text', () => {
    const oversized = 'a'.repeat(LONG_PASTE_MAX_BYTES + 1);
    expect(() => createTextNoteAttachment(oversized, 1)).toThrow('LONG_PASTE_TOO_LARGE');
  });

  it('detects text note filenames', () => {
    expect(isTextNoteFilename('pasted-note-1.txt')).toBe(true);
    expect(isTextNoteFilename('notes.txt')).toBe(false);
    expect(isTextNoteFilename('pasted-note-1.md')).toBe(false);
  });

  it('formats attachment sizes for display', () => {
    expect(formatAttachmentSize(512)).toBe('512 B');
    expect(formatAttachmentSize(2048)).toBe('2.0 KB');
    expect(formatAttachmentSize(2 * 1024 * 1024)).toBe('2.0 MB');
  });
});
