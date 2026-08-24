"use client";

import { FormEvent, useMemo, useState } from "react";
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
  const commonValue = COMMON_HP.includes(current) ? String(current) : "custom";

  const copy = scenarioSource === "fallback_100"
    ? {
      status: `Расчёт по ${current} л.с.`,
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
            status: `Вы выбрали ${current} л.с.`,
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
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const options = useMemo(() => COMMON_HP, []);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = Number(manual);
    if (Number.isFinite(value) && value >= 20 && value <= 2500) apply(value);
  };

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

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(132px,.48fr)] gap-2">
        <div className="relative min-w-0">
          <select
            aria-label="Выбрать мощность в лошадиных силах"
            value={commonValue}
            onChange={(event) => {
              if (event.target.value === "auto") return apply(null);
              if (event.target.value === "custom") return;
              const value = Number(event.target.value);
              setManual(event.target.value);
              apply(value);
            }}
            className="ac-editable-power__control h-11 w-full min-w-0 appearance-none rounded-xl px-3 pr-11 text-[13px] font-black outline-none"
          >
            <option value="auto">Авто</option>
            {options.map((value) => <option key={value} value={value}>{value} л.с.</option>)}
            {!COMMON_HP.includes(current) ? <option value="custom">{current} л.с.</option> : <option value="custom">Другая…</option>}
          </select>
          <svg viewBox="0 0 20 20" className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ac-muted)]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
        </div>

        <form onSubmit={submit} className="ac-editable-power__manual flex h-11 min-w-0 items-center overflow-hidden rounded-xl">
          <input
            type="number"
            min={20}
            max={2500}
            step={1}
            inputMode="numeric"
            value={manual}
            onChange={(event) => setManual(event.target.value)}
            aria-label="Ввести мощность вручную"
            className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-center text-[13px] font-black outline-none"
          />
          <button type="submit" className="ac-editable-power__apply h-full shrink-0 px-2.5 text-[11px] font-black" aria-label="Пересчитать по введённой мощности">л.с. ↻</button>
        </form>
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
      .ac-editable-power__control,
      .ac-editable-power__manual {
        border: 1px solid color-mix(in srgb, var(--ac-text) 12%, transparent);
        background: var(--ac-surface-3, #313d4f);
        color: var(--ac-text);
      }
      .ac-editable-power__control:focus,
      .ac-editable-power__manual:focus-within {
        border-color: color-mix(in srgb, var(--ac-text) 28%, transparent);
      }
      .ac-editable-power__manual input {
        color: var(--ac-text) !important;
        -webkit-text-fill-color: var(--ac-text) !important;
      }
      .ac-editable-power__apply {
        border-left: 1px solid color-mix(in srgb, var(--ac-text) 10%, transparent);
        color: var(--ac-text);
        background: color-mix(in srgb, var(--ac-text) 6%, transparent);
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
      html[data-theme="light"] .ac-editable-power__control,
      html[data-theme="light"] .ac-editable-power__manual {
        border-color: #cbd3de;
        background: #ffffff;
        color: #171b23;
      }
      html[data-theme="light"] .ac-editable-power__control,
      html[data-theme="light"] .ac-editable-power__manual input,
      html[data-theme="light"] .ac-editable-power__apply {
        color: #171b23 !important;
        -webkit-text-fill-color: #171b23 !important;
      }
      html[data-theme="light"] .ac-editable-power__apply {
        border-left-color: #d7dde5;
        background: #eef1f5;
      }
      html[data-theme="light"] .ac-editable-power__control option {
        color: #171b23;
        background: #ffffff;
      }
      @media (max-width: 420px) {
        .ac-editable-power {
          padding-left: .75rem !important;
          padding-right: .75rem !important;
        }
        .ac-editable-power > div:last-of-type {
          grid-template-columns: minmax(0,1fr) minmax(124px,.48fr) !important;
          gap: .45rem !important;
        }
        .ac-editable-power__apply {
          padding-left: .45rem !important;
          padding-right: .45rem !important;
        }
      }
    `}</style>
  </>;
}
