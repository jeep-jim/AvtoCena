"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const ENABLED_KEY = "avtocena_crm_notifications_enabled";
const BASELINE_KEY = "avtocena_crm_lead_alert_baseline";

type LeadPreview = {
  id: string;
  createdAt?: string;
  status?: string;
  name?: string;
  phone?: string;
  telegram?: string;
  car?: string;
  offerTitle?: string;
  selectedOffers?: Array<{ title?: string }>;
};

function createdMs(lead: LeadPreview) {
  const parsed = Date.parse(String(lead.createdAt || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function leadTitle(lead: LeadPreview) {
  return lead.car
    || lead.offerTitle
    || lead.selectedOffers?.[0]?.title
    || "Новая заявка";
}

function beep() {
  try {
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.34);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.36);
    oscillator.addEventListener("ended", () => void context.close());
  } catch {
    // Browser sound is best-effort and must never break CRM.
  }
}

export function CrmLiveAlerts() {
  const [newCount, setNewCount] = useState(0);
  const [enabled, setEnabled] = useState(false);
  const [toast, setToast] = useState<LeadPreview | null>(null);
  const baselineRef = useRef(0);
  const initializedRef = useRef(false);

  const poll = useCallback(async () => {
    try {
      const response = await fetch("/api/leads", { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json().catch(() => null) as { leads?: LeadPreview[] } | null;
      const leads = Array.isArray(payload?.leads) ? payload!.leads! : [];
      setNewCount(leads.filter((lead) => lead.status === "new").length);

      const newest = [...leads].sort((a, b) => createdMs(b) - createdMs(a))[0];
      const newestMs = newest ? createdMs(newest) : 0;
      if (!initializedRef.current) {
        initializedRef.current = true;
        const stored = Number(window.localStorage.getItem(BASELINE_KEY) || 0);
        baselineRef.current = Math.max(stored, newestMs, Date.now());
        window.localStorage.setItem(BASELINE_KEY, String(baselineRef.current));
        return;
      }

      if (!newest || !newestMs || newestMs <= baselineRef.current) return;
      baselineRef.current = newestMs;
      window.localStorage.setItem(BASELINE_KEY, String(newestMs));
      setToast(newest);

      if (enabled) {
        beep();
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification("Новая заявка · АвтоЦена CRM", {
            body: `${newest.name || newest.phone || newest.telegram || "Новый клиент"} — ${leadTitle(newest)}`,
            tag: `avtocena-lead-${newest.id}`,
          });
        }
      }
    } catch {
      // Keep polling silently; a transient network error must not disturb work.
    }
  }, [enabled]);

  useEffect(() => {
    const storedEnabled = window.localStorage.getItem(ENABLED_KEY) === "1";
    setEnabled(storedEnabled);
    void poll();
    const timer = window.setInterval(() => void poll(), 20_000);
    return () => window.clearInterval(timer);
  }, [poll]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 9_000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function toggleAlerts() {
    if (enabled) {
      setEnabled(false);
      window.localStorage.setItem(ENABLED_KEY, "0");
      return;
    }

    if ("Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission().catch(() => "denied");
    }
    setEnabled(true);
    window.localStorage.setItem(ENABLED_KEY, "1");
    beep();
  }

  return (
    <>
      <button
        type="button"
        onClick={toggleAlerts}
        className="relative inline-flex min-h-10 items-center gap-2 rounded-full border border-white/10 bg-white/8 px-3 py-2 text-xs font-black text-white/75 transition hover:bg-white/14"
        title={enabled ? "Звуковые и браузерные уведомления включены" : "Включить уведомления о новых заявках"}
      >
        <span aria-hidden="true">{enabled ? "🔔" : "🔕"}</span>
        <span className="hidden sm:inline">Заявки</span>
        {newCount > 0 ? (
          <span className="grid min-h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1.5 text-[10px] text-white">
            {newCount > 99 ? "99+" : newCount}
          </span>
        ) : null}
      </button>

      {toast ? (
        <a
          href="/crm/leads"
          className="fixed right-4 top-4 z-[120] w-[min(92vw,390px)] rounded-2xl border border-red-400/35 bg-[#1f2937] p-4 shadow-2xl"
        >
          <div className="text-xs font-black uppercase tracking-[0.14em] text-red-300">Новая заявка</div>
          <div className="mt-1 font-black text-white">{toast.name || toast.phone || toast.telegram || "Новый клиент"}</div>
          <div className="mt-1 text-sm font-bold text-white/65">{leadTitle(toast)}</div>
          <div className="mt-3 text-xs font-black text-red-200">Открыть заявку →</div>
        </a>
      ) : null}
    </>
  );
}
