"use client";
import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
export function CrmPushControl({userId}: {userId: string}) {
  const [active, setActive] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    setSupported("serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
    if (!("serviceWorker" in navigator)) return;
    let mounted = true;
    void navigator.serviceWorker.getRegistration("/").then(async registration => {
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) return;
      const response = await fetch("/api/crm/push", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(subscription)});
      if (mounted && response.ok) setActive(true);
    }).catch(() => {});
    return () => { mounted = false; };
  }, [userId]);
  async function toggle() {
    setBusy(true); setMessage("");
    try {
      if (!supported) { setMessage("На iPhone добавьте сайт на экран «Домой» и откройте его оттуда. Нужен iOS 16.4 или новее."); return; }
      if (!active && await Notification.requestPermission() !== "granted") { setMessage("Разрешите уведомления для сайта в настройках браузера."); return; }
      const registration = await navigator.serviceWorker.register("/crm-push-sw.js", {scope: "/"});
      await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (active) {
        if (subscription) {
          const response = await fetch("/api/crm/push", {method: "DELETE", headers: {"content-type": "application/json"}, body: JSON.stringify({endpoint: subscription.endpoint})});
          if (!response.ok) throw Error();
          await subscription.unsubscribe();
        }
        setActive(false); return;
      }
      const config = await fetch("/api/crm/push", {cache: "no-store"}); if (!config.ok) throw Error();
      const {publicKey} = await config.json();
      const bytes = Uint8Array.from(atob(publicKey.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0));
      subscription ||= await registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: bytes});
      const response = await fetch("/api/crm/push", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(subscription)});
      if (!response.ok) { await subscription.unsubscribe(); throw Error(); }
      setActive(true); setMessage("Уведомления на этом устройстве включены. Звук push настраивается в телефоне.");
    } catch { setMessage("Не удалось сохранить подписку. Проверьте разрешения браузера и повторите."); }
    finally { setBusy(false); }
  }
  return <div className="border-t border-[var(--ac-border)] pt-1">
    <button type="button" onClick={() => void toggle()} disabled={busy} aria-pressed={active} className="flex min-h-11 w-full items-center gap-2 px-2 text-left text-[13px]">{active ? <Bell size={18}/> : <BellOff size={18}/>}<span>{busy ? "Сохраняем…" : active ? "Push на устройстве: включены" : "Включить push на устройстве"}</span></button>
    {message ? <p role="status" className="px-2 pb-2 text-xs leading-5">{message}</p> : null}
  </div>;
}
export async function unsubscribeStaffPush() {
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) { await fetch("/api/crm/push", {method: "DELETE", headers: {"content-type": "application/json"}, body: JSON.stringify({endpoint: subscription.endpoint})}); await subscription.unsubscribe(); }
    const notices = await registration?.getNotifications(); notices?.forEach(notice => notice.close());
    if ("clearAppBadge" in navigator) await (navigator as any).clearAppBadge();
  } catch {}
}
