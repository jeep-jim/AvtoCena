"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
};

function PinIcon() {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21C16 16.8 18 13.7 18 10A6 6 0 0 0 6 10C6 13.7 8 16.8 12 21Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" /><circle cx="12" cy="10" r="2.3" stroke="currentColor" strokeWidth="1.9" /></svg>;
}

export function CityPicker({ value, onChange }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [detected, setDetected] = useState("");

  useEffect(() => setQuery(value), [value]);

  useEffect(() => {
    const saved = localStorage.getItem("avtocena_city")?.trim() || "";
    if (saved) {
      onChange(saved);
      setQuery(saved);
      return;
    }
    const timer = window.setTimeout(() => {
      fetch("/api/location/city", { cache: "no-store" })
        .then((response) => response.ok ? response.json() : null)
        .then((data) => { const city = String(data?.city || "").trim(); if (city) setDetected(city); })
        .catch(() => undefined);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [onChange]);

  useEffect(() => {
    if (!open || query.trim().length < 2 || query.trim() === value.trim()) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/location/city?q=${encodeURIComponent(query.trim())}`, { cache: "no-store", signal: controller.signal })
        .then((response) => response.ok ? response.json() : null)
        .then((data) => setSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []))
        .catch((error) => { if ((error as Error)?.name !== "AbortError") setSuggestions([]); });
    }, 260);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, query, value]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (root.current?.contains(event.target as Node)) return;
      setOpen(false);
      input.current?.blur();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const choose = (city: string) => {
    const next = city.trim();
    if (!next) return;
    onChange(next);
    setQuery(next);
    setDetected("");
    setSuggestions([]);
    setOpen(false);
    localStorage.setItem("avtocena_city", next);
    input.current?.blur();
  };

  return <div ref={root} className={`relative min-w-0 ${open || detected ? "z-[240]" : "z-0"}`}>
    <div className="ac-filter-control flex h-14 items-center gap-2 rounded-2xl px-4">
      <span className="shrink-0 text-[var(--ac-muted)]"><PinIcon /></span>
      <input
        ref={input}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); onChange(event.target.value); }}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (suggestions[0]) choose(suggestions[0]); else if (query.trim()) choose(query); } }}
        placeholder="Ваш город"
        autoFocus={false}
        autoComplete="off"
        inputMode="text"
        className="min-w-0 flex-1 bg-transparent text-sm font-black outline-none placeholder:text-red-500"
        aria-label="Город доставки"
      />
      {query ? <button type="button" onClick={() => { onChange(""); setQuery(""); setSuggestions([]); localStorage.removeItem("avtocena_city"); input.current?.focus(); }} className="text-lg text-[var(--ac-muted)]" aria-label="Очистить город">×</button> : null}
    </div>

    {detected && !value ? <div className="ac-filter-dropdown absolute left-0 right-0 top-[calc(100%+7px)] rounded-2xl p-3">
      <div className="text-xs font-bold text-[var(--ac-muted)]">Ваш город — <span className="text-[var(--ac-text)]">{detected}</span>?</div>
      <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => choose(detected)} className="avto-button h-10 rounded-xl text-sm font-black">Да</button><button type="button" onClick={() => { setDetected(""); setOpen(true); requestAnimationFrame(() => input.current?.focus()); }} className="h-10 rounded-xl bg-white/[0.06] text-sm font-black">Изменить</button></div>
    </div> : null}

    {open && suggestions.length ? <div className="ac-filter-dropdown absolute left-0 right-0 top-[calc(100%+7px)] overflow-hidden rounded-2xl p-2">
      <div className="ac-hide-scrollbar max-h-64 overflow-y-auto">{suggestions.map((city) => <button key={city} type="button" onClick={() => choose(city)} className="ac-filter-option flex min-h-10 w-full items-center rounded-xl px-3 py-2 text-left text-sm font-bold">{city}</button>)}</div>
    </div> : null}
  </div>;
}
