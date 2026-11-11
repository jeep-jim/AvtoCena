/** Shared by the form and API; formatting never changes the account identity. */
export function normalizeAccountPhone(input: unknown): string {
  const raw = String(input ?? '').trim();
  if (!raw) throw Error('Введите номер телефона, указанный при регистрации или новый номер для создания кабинета.');
  if (!/^\+?[\d\s()–-]+$/.test(raw)) throw Error('Введите номер телефона цифрами с кодом страны, например +7 999 123-45-67.');
  let digits = raw.replace(/\D/g, '');
  if (digits[0] === '7' || (digits[0] === '8' && !raw.startsWith('+'))) {
    if (digits.length !== 11) throw Error(digits.length < 11
      ? `В номере не хватает цифр: введено ${digits.length} из 11, включая код страны.`
      : 'В номере слишком много цифр: нужно 11, включая код страны.');
    if (digits[0] === '8') digits = '7' + digits.slice(1);
  }
  if (digits.length < 10) throw Error('В номере недостаточно цифр. Введите полный номер с кодом страны.');
  if (digits.length > 15) throw Error('В номере слишком много цифр. Проверьте номер и код страны.');
  if (!/^[1-9]\d{9,14}$/.test(digits)) throw Error('Введите телефон с кодом страны, например +7 999 123-45-67.');
  return '+' + digits;
}

export function accountPhoneError(input: unknown): string {
  try { normalizeAccountPhone(input); return ''; }
  catch (error) { return error instanceof Error ? error.message : 'Проверьте номер телефона.'; }
}
