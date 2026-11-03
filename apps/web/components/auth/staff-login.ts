// Staff logins are local identifiers; a Telegram account is not required.
export function validStaffLogin(value: string) {
  return /^[a-z0-9_]{5,32}$/.test(value);
}
