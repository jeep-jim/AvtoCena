export function toJapanAuctionDate(value) {
  const text = String(value ?? "").trim();
  const timestamp = Date.parse(text);
  if (Number.isFinite(timestamp)) return new Date(timestamp + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10);
  return text.match(/20\d{2}-\d{2}-\d{2}/)?.[0] || "";
}
