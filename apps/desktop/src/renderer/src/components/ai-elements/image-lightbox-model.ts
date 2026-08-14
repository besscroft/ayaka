export function wrapImageIndex(index: number, direction: -1 | 1, length: number): number {
  if (length <= 0) return 0;
  return (index + direction + length) % length;
}

export function clampImageIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(Math.max(index, 0), length - 1);
}
