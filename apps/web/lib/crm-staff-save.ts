import { normalizeTelegramUsername } from "./auth";

export function staffIdentityChanged(previous: string, next: string) {
  return normalizeTelegramUsername(previous) !== normalizeTelegramUsername(next);
}

// Relative Location keeps the browser on the public origin behind a proxy.
export function staffRedirect(path: string) {
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\r\n]/.test(path)) {
    throw new Error("invalid_staff_redirect");
  }
  return new Response(null, { status: 303, headers: { Location: path } });
}
