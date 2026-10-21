export const CUSTOMER_NAME_MIN = 2;
export const CUSTOMER_NAME_MAX = 60;
// Validate the submitted value as-is: spaces and punctuation must not be silently removed.
export function customerNameError(value: unknown): string | null {
  if (typeof value !== 'string' || !/^[A-Za-zА-Яа-яЁё]{2,60}$/.test(value))
    return 'Имя — от 2 до 60 букв кириллицы или латиницы, без пробелов, цифр и символов.';
  if (['sex', 'секс', 'хуй', 'блядь', 'блять', 'пизда', 'fuck', 'shit'].includes(value.toLowerCase()))
    return 'Введите ваше имя.';
  return null;
}
