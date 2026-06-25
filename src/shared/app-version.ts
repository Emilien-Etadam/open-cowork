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

/** True when `candidate` is a newer EE build than `current`. */
export function isEeVersionNewer(candidate: string, current: string): boolean {
  const candidateParts = parseEeSuffix(candidate);
  const currentParts = parseEeSuffix(current);

  if (candidateParts && currentParts) {
    const length = Math.max(candidateParts.length, currentParts.length);
    for (let index = 0; index < length; index += 1) {
      const next = candidateParts[index] ?? 0;
      const prev = currentParts[index] ?? 0;
      if (next > prev) {
        return true;
      }
      if (next < prev) {
        return false;
      }
    }
    return false;
  }

  return normalizeVersionTag(candidate) !== normalizeVersionTag(current);
}
