// Public request forms accept a Russian national number or 7/8-prefixed input.
export function phoneNational(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("7") || digits.startsWith("8")) digits = digits.slice(1);
  return digits.slice(0, 10);
}
export function normalizeRuPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  const national = digits.length === 11 && /^[78]/.test(digits) ? digits.slice(1) : digits;
  return /^\d{10}$/.test(national) ? `+7${national}` : "";
}
