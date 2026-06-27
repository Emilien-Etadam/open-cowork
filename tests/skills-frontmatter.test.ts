import { describe, expect, it } from 'vitest';
import {
  parseSkillFrontmatter,
  validateSkillName,
} from '../src/main/skills/skills-frontmatter';

describe('skills-frontmatter', () => {
  it('parses YAML front-matter metadata', () => {
    const metadata = parseSkillFrontmatter(`---
name: pdf
description: Generate PDF documents
---
# Body`);
    expect(metadata).toEqual({
      name: 'pdf',
      description: 'Generate PDF documents',
    });
  });

  it('returns null when required fields are missing', () => {
    expect(parseSkillFrontmatter('name: only-name')).toBeNull();
  });

  it('rejects unsafe skill names', () => {
    expect(() => validateSkillName('../evil')).toThrow('Invalid skill name');
    expect(() => validateSkillName('')).toThrow('Invalid skill name');
  });
});
