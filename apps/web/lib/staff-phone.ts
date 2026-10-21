// A staff contact may be Russian or an international number with a country code.
export function normalizeStaffPhone(value: string): string {
  const input = value.trim();
  if (!input || !/^\+?[\d\s().-]+$/.test(input)) return "";
  const digits = input.replace(/\D/g, "");
  if (!input.startsWith("+") && digits.length === 10) return `+7${digits}`;
  if (!input.startsWith("+") && digits.length === 11 && /^[78]/.test(digits)) return `+7${digits.slice(1)}`;
  return input.startsWith("+") && /^[1-9]\d{6,14}$/.test(digits) ? `+${digits}` : "";
}
