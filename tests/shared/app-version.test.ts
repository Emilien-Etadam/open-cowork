import { describe, expect, it } from 'vitest';

import {
  formatEeDisplayVersion,
  isEeVersionNewer,
  normalizeVersionTag,
} from '../../src/shared/app-version';

describe('app version helpers', () => {
  it('formats EE display versions', () => {
    expect(formatEeDisplayVersion('3.3.1-EE4.7')).toBe('EE4.7');
    expect(formatEeDisplayVersion('v3.3.1-EE4.6')).toBe('EE4.6');
  });

  it('normalizes release tags', () => {
    expect(normalizeVersionTag('v3.3.1-EE4.7')).toBe('3.3.1-EE4.7');
  });

  it('compares EE build numbers', () => {
    expect(isEeVersionNewer('3.3.1-EE4.7', '3.3.1-EE4.6')).toBe(true);
    expect(isEeVersionNewer('3.3.1-EE4.6', '3.3.1-EE4.7')).toBe(false);
    expect(isEeVersionNewer('3.3.1-EE4.7', '3.3.1-EE4.7')).toBe(false);
  });
});
