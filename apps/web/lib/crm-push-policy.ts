export function validPushSubscription(value: any): boolean {
  try {
    const url = new URL(value.endpoint);
    const host = url.hostname;
    const allowed = host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com" || host.endsWith(".push.apple.com") || host.endsWith(".notify.windows.com");
    const decode = (v: unknown, size: number) => typeof v === "string" && /^[\w-]+$/.test(v) && Buffer.from(v, "base64url").length === size;
    return value.endpoint.length <= 2048 && allowed && url.protocol === "https:" && !url.port && !url.username && !url.password && decode(value.keys?.auth, 16) && decode(value.keys?.p256dh, 65);
  } catch { return false; }
}
