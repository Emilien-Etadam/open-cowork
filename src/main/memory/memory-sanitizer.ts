import type { MemoryInjectionPolicy } from '../config/config-schema';

export type { MemoryInjectionPolicy };

const MEMORY_DELIMITER_PATTERN = /<\/?memory_context>|<\/?core_memory>|<\/?experience_memory>/gi;

const SUSPICIOUS_PATTERNS = [
  /ignore (all )?(previous|prior|above) instructions/i,
  /disregard (all )?(previous|prior|above) instructions/i,
  /you are now (a |an )?/i,
  /^system:\s*/im,
  /^developer:\s*/im,
  /^assistant:\s*/im,
];

export function escapeMemoryContextText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function containsSuspiciousMemoryContent(text: string): boolean {
  if (MEMORY_DELIMITER_PATTERN.test(text)) {
    MEMORY_DELIMITER_PATTERN.lastIndex = 0;
    return true;
  }
  return SUSPICIOUS_PATTERNS.some((pattern) => pattern.test(text));
}

export function sanitizeMemoryContent(
  text: string,
  policy: MemoryInjectionPolicy = 'escape'
): string {
  if (!text) {
    return text;
  }

  if (policy === 'block' && containsSuspiciousMemoryContent(text)) {
    return '';
  }

  let result = text.replace(MEMORY_DELIMITER_PATTERN, '');
  if (policy === 'strip-suspicious') {
    for (const pattern of SUSPICIOUS_PATTERNS) {
      result = result.replace(pattern, '[filtered]');
    }
  }

  return result.trim();
}

export function getMemoryInjectionPolicy(
  runtime: { injectionPolicy?: MemoryInjectionPolicy } | undefined
): MemoryInjectionPolicy {
  const policy = runtime?.injectionPolicy;
  if (policy === 'strip-suspicious' || policy === 'block') {
    return policy;
  }
  return 'escape';
}
