"use client";

import { useId, useRef } from "react";
import { CalendarDays } from "lucide-react";
import styles from "./InlineParameterPanels.module.css";

/** The empty value deliberately means today on the server, not a saved date. */
export function CalculationDateControl({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const openPicker = () => {
    const element = input.current;
    if (!element) return;
    element.focus({ preventScroll: true });
    // Native date editing remains available when showPicker is absent or denied
    // (older mobile engines or cross-origin frames). Never open on mount/focus.
    try { element.showPicker?.(); } catch { /* Keep the focused native input. */ }
  };
  return <label className={styles.calculationDate} htmlFor={id}>
    Расчёт таможни на дату
    <span className={styles.dateControl} data-calculation-date-control data-empty={!value || undefined}>
      <input ref={input} id={id} aria-label="Дата таможенного расчёта" type="date" value={value} onChange={event => onChange(event.target.value)} onClick={openPicker} />
      {!value ? <span className={styles.datePlaceholder} aria-hidden="true">Сегодня</span> : null}
      <CalendarDays className={styles.calendarIcon} size={18} aria-hidden="true" data-calculation-calendar />
    </span>
  </label>;
}
