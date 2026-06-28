/** Strip a leading `v` from release tags. */
export function normalizeVersionTag(tag: string): string {
  return tag.trim().replace(/^v/i, '');
}

/** Extract the EE suffix for display (e.g. `3.3.1-EE4.7` → `EE4.7`). */
export function formatEeDisplayVersion(version: string): string {
  const normalized = normalizeVersionTag(version);
  const match = normalized.match(/-EE(.+)$/i);
  if (match) {
    return `EE${match[1]}`;
  }
  return normalized;
}

function parseEeSuffix(version: string): number[] | null {
  const match = normalizeVersionTag(version).match(/-EE(\d+(?:\.\d+)*)/i);
  if (!match) {
    return null;
  }

  return match[1].split('.').map((part) => Number.parseInt(part, 10));
}

function parseSemver(version: string): number[] | null {
  const normalized = normalizeVersionTag(version);
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }

  return [
    Number.parseInt(match[1], 10),
    Number.parseInt(match[2], 10),
    Number.parseInt(match[3], 10),
  ];
}

function compareNumericParts(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const next = left[index] ?? 0;
    const prev = right[index] ?? 0;
    if (next > prev) {
      return 1;
    }
    if (next < prev) {
      return -1;
    }
  }
  return 0;
}

/** True when `candidate` is a newer build than `current` (EE suffix or semver). */
export function isEeVersionNewer(candidate: string, current: string): boolean {
  const candidateParts = parseEeSuffix(candidate);
  const currentParts = parseEeSuffix(current);

  if (candidateParts && currentParts) {
    return compareNumericParts(candidateParts, currentParts) > 0;
  }

  const candidateSemver = parseSemver(candidate);
  const currentSemver = parseSemver(current);
  if (candidateSemver && currentSemver) {
    return compareNumericParts(candidateSemver, currentSemver) > 0;
  }

  return normalizeVersionTag(candidate) !== normalizeVersionTag(current);
}
