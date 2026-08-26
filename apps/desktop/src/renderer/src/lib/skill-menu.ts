export function getNextMentionSkillIndex(
  currentIndex: number,
  itemCount: number,
  key: string,
): number | null {
  if (itemCount <= 0) return null;
  if (key === "ArrowDown") return (currentIndex + 1) % itemCount;
  if (key === "ArrowUp") return (currentIndex - 1 + itemCount) % itemCount;
  return null;
}
