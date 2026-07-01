export const LONG_PASTE_CHAR_THRESHOLD = 2000;
export const LONG_PASTE_LINE_THRESHOLD = 40;
export const LONG_PASTE_MAX_BYTES = 2 * 1024 * 1024;
export const TEXT_NOTE_FILENAME_PREFIX = 'pasted-note-';

export interface TextNoteAttachment {
  name: string;
  path: string;
  size: number;
  type: string;
  inlineDataBase64: string;
  isTextNote: true;
}

export function countTextNoteLines(text: string): number {
  if (text.length === 0) return 0;
  return text.split(/\r\n|\r|\n/).length;
}

export function getTextByteSize(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function shouldConvertLongPaste(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return false;
  }
  return (
    trimmed.length >= LONG_PASTE_CHAR_THRESHOLD ||
    countTextNoteLines(trimmed) >= LONG_PASTE_LINE_THRESHOLD
  );
}

export function isTextNoteFilename(filename: string): boolean {
  return filename.startsWith(TEXT_NOTE_FILENAME_PREFIX) && filename.endsWith('.txt');
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function encodeTextToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function createTextNoteAttachment(text: string, index: number): TextNoteAttachment {
  const byteSize = getTextByteSize(text);
  if (byteSize > LONG_PASTE_MAX_BYTES) {
    throw new Error('LONG_PASTE_TOO_LARGE');
  }

  const safeIndex = Number.isFinite(index) && index > 0 ? Math.floor(index) : 1;

  return {
    name: `${TEXT_NOTE_FILENAME_PREFIX}${safeIndex}.txt`,
    path: '',
    size: byteSize,
    type: 'text/plain',
    inlineDataBase64: encodeTextToBase64(text),
    isTextNote: true,
  };
}
