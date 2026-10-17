/** Browser storage is renewed daily; authorization still checks live account revocation. */
export const SESSION_COOKIE_MAX_AGE = 400 * 86400;
export const persistentSessionFields = (now = Date.now()) => ({exp: 0, persistent: true as const, renewedAt: now});
export function sessionTimeValid(payload: {exp?: unknown; persistent?: unknown; renewedAt?: unknown}, legacyMilliseconds = false, now = Date.now()) {
  if (payload.persistent === true) return payload.exp === 0 && typeof payload.renewedAt === "number" && Number.isFinite(payload.renewedAt) && payload.renewedAt > 0;
  return typeof payload.exp === "number" && Number.isFinite(payload.exp) && payload.exp > (legacyMilliseconds ? now : Math.floor(now / 1000));
}
export function sessionNeedsRenewal(payload: {persistent?: unknown; renewedAt?: unknown}, now = Date.now()) {
  return payload.persistent !== true || typeof payload.renewedAt !== "number" || now - payload.renewedAt >= 86400000;
}
