"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const COMMON_HP = [50, 75, 90, 100, 110, 120, 130, 140, 150, 160, 180, 200, 220, 250, 300, 350, 400, 500, 600];

export function EditablePowerTile({
  currentHp,
  requiresConfirmation,
  scenarioSource,
}: {
  currentHp: number;
  requiresConfirmation: boolean;
  scenarioSource?: string | null;
  fullWidth?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const current = Math.max(20, Math.min(2500, Math.round(Number(currentHp || 100))));
  const [manual, setManual] = useState(String(current));
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAppliedQuery = useRef(search.toString());

  const copy = scenarioSource === "fallback_100"
    ? {
      status: "Нужно уточнить",
      hint: "Мощность не нашли. Выберите точное значение, если знаете его — цена пересчитается.",
    }
    : scenarioSource === "knowledge_reference"
      ? {
        status: "Из базы модели",
        hint: "Используем справочное значение. Можно уточнить мощность именно этого автомобиля.",
      }
      : scenarioSource === "source_peak_estimate"
        ? {
          status: "Из объявления",
          hint: "Значение предварительное. При необходимости уточните его по документам автомобиля.",
        }
        : scenarioSource === "customer_input"
          ? {
            status: "Выбрано вручную",
            hint: "Цена пересчитана по выбранной мощности. Перед покупкой значение нужно подтвердить по документам.",
          }
          : {
            status: requiresConfirmation ? "Нужно уточнить" : "Мощность найдена",
            hint: requiresConfirmation
              ? "Выберите точную мощность — цена сразу пересчитается."
              : "При необходимости мощность можно изменить и посмотреть другой расчёт.",
          };

  const apply = (value?: number | null) => {
    const params = new URLSearchParams(search.toString());
    if (value && Number.isFinite(value) && value >= 20 && value <= 2500) params.set("powerHp", String(Math.round(value)));
    else params.delete("powerHp");
    const query = params.toString();
    if (query === lastAppliedQuery.current) return;
    lastAppliedQuery.current = query;
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const options = useMemo(() => COMMON_HP, []);
  const parsedManual = (value = manual) => {
    const parsed = Number(String(value).replace(",", ".").replace(/[^0-9.]/g, ""));
    return Number.isFinite(parsed) && parsed >= 20 && parsed <= 2500 ? Math.round(parsed) : 0;
  };
  const commitManual = (value = manual) => {
    if (debounce.current) {
      clearTimeout(debounce.current);
      debounce.current = null;
    }
    const parsed = parsedManual(value);
    if (!parsed) return;
    setManual(String(parsed));
    apply(parsed);
  };

  useEffect(() => setManual(String(current)), [current]);
  useEffect(() => { lastAppliedQuery.current = search.toString(); }, [search]);
  useEffect(() => () => {
    if (debounce.current) clearTimeout(debounce.current);
  }, []);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (root.current?.contains(event.target as Node)) return;
      if (open) commitManual();
      setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  });

  return <>
    <div
      aria-label={`Мощность: ${current} л.с.`}
      className="ac-editable-power ac-offer-spec-tile relative min-w-0 rounded-2xl px-3.5 py-3.5"
      style={{ gridColumn: "1 / -1" }}
    >
      <div className="flex min-w-0 items-start gap-3">
        <svg viewBox="0 0 24 24" className="ac-editable-power__icon mt-0.5 h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13.5 2.8 5.8 13h5.1l-.7 8.2L18.3 11h-5.1z" /></svg>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[11px] font-black uppercase tracking-[0.12em] text-[var(--ac-muted)]">Мощность</span>
            <span className="ac-editable-power__status rounded-full px-2 py-0.5 text-[10px] font-black">{copy.status}</span>
          </div>
          <p className="ac-editable-power__hint mt-1 text-[11px] font-semibold leading-4">{copy.hint}</p>
        </div>
      </div>

      <div ref={root} className={`relative mt-3 min-w-0 ${open ? "z-[80]" : "z-0"}`}>
        <div
          className="ac-filter-control ac-editable-power__control flex h-13 min-w-0 items-center overflow-hidden rounded-[15px]"
          onMouseDown={(event) => {
            if ((event.target as HTMLElement).tagName === "INPUT") return;
            event.preventDefault();
            root.current?.querySelector("input")?.focus();
            setOpen(true);
          }}
        >
          <input
            type="text"
            inputMode="numeric"
            value={manual}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onChange={(event) => {
              const value = event.target.value.replace(/[^0-9]/g, "").slice(0, 4);
              setManual(value);
              setOpen(true);
              if (debounce.current) clearTimeout(debounce.current);
              const parsed = parsedManual(value);
              if (parsed) debounce.current = setTimeout(() => commitManual(value), 500);
            }}
            onBlur={(event) => {
              if (root.current?.contains(event.relatedTarget as Node)) return;
              commitManual();
              setOpen(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitManual();
                setOpen(false);
                event.currentTarget.blur();
              }
              if (event.key === "Escape") {
                setManual(String(current));
                setOpen(false);
                event.currentTarget.blur();
              }
            }}
            aria-label="Выбрать или ввести мощность в лошадиных силах"
            aria-expanded={open}
            aria-controls="offer-power-options"
            role="combobox"
            className="h-full min-w-0 flex-1 bg-transparent px-3 text-[13px] font-black outline-none"
          />
          <span className="pointer-events-none shrink-0 pr-3 text-[12px] font-black text-[var(--ac-muted)]">л.с.</span>
          <svg viewBox="0 0 20 20" className={`pointer-events-none mr-3 h-4 w-4 shrink-0 text-[var(--ac-muted)] transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
        </div>
        {open ? <div id="offer-power-options" role="listbox" className="ac-filter-dropdown ac-editable-power__options absolute left-0 right-0 top-[calc(100%+7px)] max-h-56 overflow-y-auto rounded-2xl p-2">
          <button type="button" role="option" aria-selected={!search.get("powerHp")} onMouseDown={(event) => event.preventDefault()} onClick={() => { setManual(String(current)); apply(null); setOpen(false); }} className={`ac-filter-option flex min-h-10 w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-bold ${!search.get("powerHp") ? "is-active" : ""}`}><span>По данным автомобиля</span>{!search.get("powerHp") ? <span>✓</span> : null}</button>
          {options.map((value) => {
            // The source value may equal a common preset (for example 150 hp).
            // Until the user explicitly overrides it, only the source row is
            // selected so the list never presents two simultaneous choices.
            const active = Boolean(search.get("powerHp")) && value === parsedManual();
            return <button key={value} type="button" role="option" aria-selected={active} onMouseDown={(event) => event.preventDefault()} onClick={() => { setManual(String(value)); apply(value); setOpen(false); }} className={`ac-filter-option flex min-h-10 w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-bold ${active ? "is-active" : ""}`}><span>{value} л.с.</span>{active ? <span>✓</span> : null}</button>;
          })}
        </div> : null}
      </div>
    </div>
    <style>{`
      .ac-offer-spec-grid > .ac-editable-power {
        grid-column: 1 / -1 !important;
        width: 100% !important;
      }
      .ac-editable-power__icon {
        color: var(--ac-text);
        opacity: .58;
      }
      .ac-editable-power__hint {
        color: var(--ac-muted);
      }
      .ac-editable-power__status {
        background: var(--ac-surface-3, #313d4f);
        color: var(--ac-text);
      }
      .ac-editable-power__control {
        border: 1px solid color-mix(in srgb, var(--ac-text) 12%, transparent);
        background: var(--ac-surface-3, #313d4f);
        color: var(--ac-text);
      }
      .ac-editable-power__control:focus,
      .ac-editable-power__control:focus-within {
        border-color: color-mix(in srgb, var(--ac-text) 28%, transparent);
      }
      .ac-editable-power__control input {
        color: var(--ac-text) !important;
        -webkit-text-fill-color: var(--ac-text) !important;
      }
      .ac-editable-power__options {
        border: 1px solid color-mix(in srgb, var(--ac-text) 12%, transparent);
        background: var(--ac-surface-2, #202a39);
        box-shadow: 0 18px 40px rgba(0,0,0,.28);
      }
      html[data-theme="light"] .ac-editable-power__status {
        background: #dfe5ed;
        color: #263142;
      }
      html[data-theme="light"] .ac-editable-power__hint {
        color: #5d6878;
      }
      html[data-theme="light"] .ac-editable-power__icon {
        color: #4b5667;
        opacity: .85;
      }
      html[data-theme="light"] .ac-editable-power__control {
        border-color: #cbd3de;
        background: #ffffff;
        color: #171b23;
      }
      html[data-theme="light"] .ac-editable-power__control,
      html[data-theme="light"] .ac-editable-power__control input {
        color: #171b23 !important;
        -webkit-text-fill-color: #171b23 !important;
      }
      html[data-theme="light"] .ac-editable-power__options {
        background: #ffffff;
        border-color: #cbd3de;
      }
      @media (max-width: 420px) {
        .ac-editable-power {
          padding-left: .75rem !important;
          padding-right: .75rem !important;
        }
      }
    `}</style>
  </>;
}
