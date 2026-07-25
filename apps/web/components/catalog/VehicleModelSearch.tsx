"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type ModelSuggestion = {
  id?: string;
  make: string;
  model: string;
  aliases?: string[];
  label: string;
};

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function compact(value: unknown) {
  return clean(value).toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, "");
}

export function VehicleModelSearch({
  value,
  make,
  placeholder = "Любая модель",
  onMakeChange,
  className = "",
}: {
  value: string;
  make: string;
  placeholder?: string;
  onMakeChange?: (make: string) => void;
  className?: string;
}) {
  const [query, setQuery] = useState(value || "");
  const [items, setItems] = useState<ModelSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => setQuery(value || ""), [value]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  const canSearch = Boolean(clean(make) || compact(query).length >= 2);
  useEffect(() => {
    if (!open || !canSearch) {
      setItems([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ q: clean(query), make: clean(make), limit: "30" });
        const response = await fetch(`/api/catalog/models?${params.toString()}`, { cache: "no-store", signal: controller.signal });
        const payload = response.ok ? await response.json() : { items: [] };
        setItems(Array.isArray(payload?.items) ? payload.items : []);
      } catch {
        if (!controller.signal.aborted) setItems([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 160);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [canSearch, make, open, query]);

  const exact = useMemo(() => {
    const requested = compact(query);
    return items.find((item) => compact(item.model) === requested || (item.aliases || []).some((alias) => compact(alias) === requested));
  }, [items, query]);

  const choose = (item: ModelSuggestion, submit = false) => {
    setQuery(item.model);
    setOpen(false);
    onMakeChange?.(item.make);
    const form = root.current?.closest("form");
    const modelInput = input.current;
    const makeInput = form?.querySelector<HTMLInputElement>('input[name="make"]');
    if (modelInput) modelInput.value = item.model;
    if (makeInput) makeInput.value = item.make;
    if (submit && form) window.requestAnimationFrame(() => form.requestSubmit());
  };

  return <div ref={root} className={`relative min-w-0 ${open ? "z-[235]" : "z-0"} ${className}`}>
    <input
      ref={input}
      type="search"
      name="model"
      value={query}
      placeholder={placeholder}
      autoComplete="off"
      spellCheck={false}
      onFocus={() => setOpen(true)}
      onChange={(event) => {
        setQuery(event.target.value);
        setOpen(true);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        const candidate = exact || items[0];
        if (!candidate) return;
        event.preventDefault();
        choose(candidate, true);
      }}
      className="ac-filter-control h-14 w-full rounded-2xl px-4 text-sm font-black outline-none"
      aria-label="Модель автомобиля"
      aria-expanded={open}
      aria-autocomplete="list"
    />
    {open ? <div className="ac-filter-dropdown absolute left-0 right-0 top-[calc(100%+7px)] overflow-hidden rounded-2xl p-2">
      <div className="ac-hide-scrollbar max-h-72 overflow-y-auto">
        {!canSearch ? <div className="px-3 py-4 text-sm font-bold text-white/45">Введите минимум 2 символа модели</div> : null}
        {canSearch && loading ? <div className="px-3 py-4 text-sm font-bold text-white/45">Ищем модель…</div> : null}
        {canSearch && !loading && items.length ? items.map((item) => <button
          key={item.id || `${item.make}:${item.model}`}
          type="button"
          onClick={() => choose(item)}
          className="ac-filter-option flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm font-bold"
        >
          <span className="min-w-0"><span className="block truncate">{item.model}</span>{!make ? <span className="block truncate text-[11px] font-semibold opacity-55">{item.make}</span> : null}</span>
          <span className="shrink-0 opacity-45">↵</span>
        </button>) : null}
        {canSearch && !loading && !items.length ? <div className="px-3 py-4 text-sm font-bold text-white/45">Совпадений в базе моделей нет</div> : null}
      </div>
    </div> : null}
  </div>;
}
