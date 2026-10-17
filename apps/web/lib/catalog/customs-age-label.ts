export function visibleBreakdownNote(note?: string): string {
  const text = String(note || "").trim();
  const labels: Record<string, string> = { up_to_3_years: "До 3 лет", from_3_to_5_years: "От 3 до 5 лет", over_5_years: "Старше 5 лет" };
  return labels[text.toLowerCase().replace(/\s+/g, "_")] || text;
}
