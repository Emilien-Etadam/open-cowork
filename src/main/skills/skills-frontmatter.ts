import * as fs from 'fs';
import * as path from 'path';

export interface SkillMetadata {
  name: string;
  description: string;
}

/**
 * Validate that a skill name is safe for use as a directory name.
 */
export function validateSkillName(name: string): void {
  if (!name || /[/\\]|\.\./.test(name)) {
    throw new Error(`Invalid skill name: ${name}`);
  }
}

/**
 * Check if a path is a dangling symlink (symlink whose target no longer exists).
 */
export function isDanglingSymlink(filePath: string): boolean {
  try {
    const lstat = fs.lstatSync(filePath);
    if (!lstat.isSymbolicLink()) {
      return false;
    }
    try {
      fs.statSync(filePath);
      return false;
    } catch {
      return true;
    }
  } catch {
    return false;
  }
}

/**
 * Parse name/description from SKILL.md YAML front-matter or inline content.
 */
export function parseSkillFrontmatter(content: string): SkillMetadata | null {
  const frontMatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const frontMatter = frontMatterMatch ? frontMatterMatch[1] : content;

  const nameMatch = frontMatter.match(/name:\s*["']?([^"'\r\n]+)["']?/);
  const descMatch = frontMatter.match(/description:\s*["']?([^"'\r\n]+)["']?/);

  if (!nameMatch || !descMatch) {
    return null;
  }

  const name = nameMatch[1].trim();
  validateSkillName(name);

  return {
    name,
    description: descMatch[1].trim(),
  };
}

/**
 * Read and parse SKILL.md metadata from a skill directory.
 */
export function readSkillMetadata(skillPath: string): SkillMetadata | null {
  const skillMdPath = path.join(skillPath, 'SKILL.md');
  if (!fs.existsSync(skillMdPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(skillMdPath, 'utf-8');
    return parseSkillFrontmatter(content);
  } catch {
    return null;
  }
}
