"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTapActivation } from "./useTapActivation";

// Broad guide only: auction-specific criteria and the original sheet take precedence.
const rows = [
  ["S / 6", "Состояние близко к новому, минимальные следы эксплуатации.", "violet"],
  ["5", "Очень хорошее состояние, возможны небольшие косметические дефекты.", "violet"],
  ["4.5", "Хорошее состояние, возможны царапины и небольшие вмятины.", "violet"],
  ["4", "Есть заметные следы эксплуатации или косметического ремонта.", "violet"],
  ["3.5", "Несколько дефектов кузова и износ салона; могут потребоваться работы.", "amber"],
  ["3", "Выраженный износ, многочисленные внешние дефекты.", "amber"],
  ["2", "Плохое внешнее состояние, значительные дефекты.", "amber"],
  ["1 / 0", "Особая категория состояния. Значение уточняют по правилам площадки и листу.", "red"],
  ["R", "В истории есть восстановление силовых элементов кузова.", "red"],
  ["RA", "Менее значительное восстановление силовых элементов по шкале площадки.", "red"],
] as const;

export function AuctionGradeGuide({ grade, className }: { grade: string; className: string }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useId();
  const tap = useTapActivation();
  useEffect(() => {
    if (!open || !dialog.current) return;
    const element = dialog.current;
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    element.showModal();
    return () => { element.close(); document.documentElement.style.overflow = previous; trigger.current?.focus({preventScroll:true}); };
  }, [open]);
  return <>
    <button ref={trigger} type="button" {...tap} onClick={() => setOpen(true)} aria-label={`Оценка ${grade}: расшифровка аукционных оценок`} aria-haspopup="dialog" aria-expanded={open} className={`${className} min-h-8 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2`}>
      Оценка {grade} <span aria-hidden="true">⌄</span>
    </button>
    {open ? createPortal(<dialog ref={dialog} aria-labelledby={heading} onCancel={event => { event.preventDefault(); setOpen(false); }} className="ac-grade-guide fixed inset-0 m-0 h-[100dvh] max-h-none w-screen max-w-none overflow-hidden border-0 bg-transparent p-0 text-[var(--ac-text)] backdrop:bg-black/65 backdrop:backdrop-blur-md">
      <div className="flex h-full items-end justify-center sm:items-center sm:p-6" onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}>
        <section className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[30px] bg-[var(--ac-surface)] sm:rounded-[26px]">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--ac-border)] px-5 py-4">
            <h2 id={heading} className="text-lg font-black">Аукционные оценки</h2>
            <button type="button" autoFocus onClick={() => setOpen(false)} aria-label="Закрыть расшифровку оценок" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--ac-surface-2)]"><X className="h-5 w-5" /></button>
          </header>
          <div className="min-h-0 overflow-y-auto overscroll-contain px-5 pb-6">
            <table className="w-full border-collapse text-left text-sm"><caption className="py-3 text-left text-xs leading-5 text-[var(--ac-muted)]">Шкалы площадок различаются. Точное состояние — в аукционном листе.</caption>
              <tbody>{rows.map(([label, description, tone]) => <tr key={label} className="border-b border-[var(--ac-border)]">
                <th scope="row" className="w-20 py-3 pr-3 align-top"><span className={`ac-grade-guide-chip ac-grade-guide-chip--${tone} inline-flex min-w-14 justify-center rounded-lg px-2 py-1.5 text-xs font-bold`}>{label}</span></th>
                <td className="py-3 leading-5">{description}</td>
              </tr>)}</tbody>
            </table>
            <p className="mt-3 text-xs leading-5 text-[var(--ac-muted)]">Буквенные оценки салона и кузова — отдельная шкала. Неизвестные обозначения сверяйте с листом.</p>
            <a href="https://providecars.co.jp/about-auction/japanese-auction-houses-use-a-grading-system" target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-xs underline underline-offset-4">Подробнее о шкале · Provide Cars ↗</a>
          </div>
        </section>
      </div>
    </dialog>, document.body) : null}
  </>;
}
