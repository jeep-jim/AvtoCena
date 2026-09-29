import { auctionGradeLabel } from "./japan-export-restriction";

// A pipe separates selections; commas remain valid decimal separators in old links.
export function auctionGradeSelections(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return [...new Set(value.split("|").map(auctionGradeLabel).filter((grade): grade is string => Boolean(grade)))];
}

export function matchesAuctionGrades(grade: unknown, selection?: string): boolean {
  if (!selection) return true;
  const normalized = auctionGradeLabel(grade);
  return Boolean(normalized && auctionGradeSelections(selection).includes(normalized));
}
