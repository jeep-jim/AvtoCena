"use client";

import {useEffect, useId, useRef, useState, type ReactNode} from 'react';
import {ChevronDown} from 'lucide-react';
import {
  validPaidKoreaReport, type PaidKoreaDiagnosis, type PaidKoreaHistory,
  type PaidKoreaInspection, type PaidKoreaReport, type PaidKoreaReportKind,
} from './paid-korea-report-contract';

const unavailable = 'Нет данных';
const number = (value: number | null) => value === null ? unavailable : value.toLocaleString('ru-RU', {maximumFractionDigits: 20});
const won = (value: number | null) => value === null ? unavailable : `${number(value)} KRW`;
const flag = (value: boolean | null) => value === null ? unavailable : value ? 'Да' : 'Нет';
const marked = (value: boolean | null) => value === null ? unavailable : value ? 'Отмечено' : 'Не отмечено';
const date = (value: string | null) => value ? value.split('-').reverse().join('.') : unavailable;
const month = (value: string | null) => value ? value.split('-').reverse().join('.') : unavailable;
const labels = (values: string[] | null) => values === null ? unavailable : values.length ? values.join(' · ') : 'В отчёте нет отметок';

function Facts({rows}: {rows: Array<[string, ReactNode]>}) {
  return <dl className="min-w-0 divide-y divide-[var(--ac-border)]">{rows.map(([label, value]) => <div key={label} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 py-2.5 text-sm">
    <dt className="min-w-0 break-words text-[var(--ac-muted)]">{label}</dt>
    <dd className="min-w-0 break-words text-right font-semibold [overflow-wrap:anywhere]">{value ?? unavailable}</dd>
  </div>)}</dl>;
}

function History({history}: {history: PaidKoreaHistory | null}) {
  if (!history) return <p role="status" className="text-sm leading-6">Сведения о страховой истории не предоставлены.</p>;
  return <div className="min-w-0 space-y-4" data-paid-korea-history>
    <Facts rows={[
      ['Дата отчёта', date(history.report_date)],
      ['Первая регистрация', date(history.first_registration_date)],
    ]}/>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      {([
        ['own', 'Ущерб этому автомобилю', history.own_damage_count, history.own_damage_cost_won],
        ['other', 'Ущерб другим автомобилям', history.other_damage_count, history.other_damage_cost_won],
      ] as const).map(([key, title, count, cost]) => <section key={key} className="min-w-0 rounded-xl bg-[var(--ac-surface-2)] p-3">
        <h3 className="text-sm font-bold">{title}</h3>
        <Facts rows={[
          ['Страховых случаев', <span data-paid-korea-count={key}>{number(count)}</span>],
          ['Сумма в отчёте', won(cost)],
        ]}/>
      </section>)}
    </div>
    <p className="text-xs leading-5 text-[var(--ac-muted)]">Суммы указаны в южнокорейских вонах (KRW).</p>
    <section className="min-w-0">
      <h3 className="text-base font-bold">Страховые случаи</h3>
      {history.accidents === null ? <p className="mt-2 text-sm text-[var(--ac-muted)]">Подробности страховых случаев не предоставлены.</p>
        : history.accidents.length === 0 ? <p className="mt-2 text-sm text-[var(--ac-muted)]">В предоставленном списке нет записей о страховых случаях.</p>
        : <ol className="mt-3 space-y-3">{history.accidents.map((claim, index) => <li key={index} className="min-w-0 rounded-xl border border-[var(--ac-border)] p-3" data-paid-korea-claim>
          <h4 className="text-sm font-bold">Случай {index + 1} · {date(claim.date)}</h4>
          <Facts rows={[
            ['Повреждено', claim.damage_to], ['Плательщик', claim.paid_by],
            ['Страховая выплата', won(claim.insurance_benefit_won)],
            ['Запчасти', won(claim.parts_won)], ['Работы', won(claim.labor_won)], ['Окраска', won(claim.painting_won)],
          ]}/>
        </li>)}</ol>}
    </section>
    <section className="min-w-0">
      <h3 className="text-base font-bold">Особые случаи</h3>
      <Facts rows={[
        ['Полная гибель: количество', number(history.total_loss_count)], ['Дата полной гибели', date(history.total_loss_date)],
        ['Полная гибель при затоплении', number(history.flood_total_loss_count)],
        ['Частичный ущерб при затоплении', number(history.flood_partial_loss_count)], ['Дата затопления', date(history.flood_date)],
        ['Угон: количество', number(history.theft_count)], ['Дата угона', date(history.theft_date)],
      ]}/>
    </section>
    <section className="min-w-0">
      <h3 className="text-base font-bold">Владение и использование</h3>
      <Facts rows={[
        ['Смен владельца', number(history.owner_changes)], ['Смен регистрационного номера', number(history.plate_changes)],
        ['Использование', history.use], ['Аренда', marked(history.rental_history)],
        ['Коммерческое использование', marked(history.commercial_history)], ['Государственное использование', marked(history.government_history)],
      ]}/>
      {history.owner_change_dates !== null && history.owner_change_dates.length > 0 && <div className="mt-3 text-sm"><h4 className="font-bold">Даты смены владельца</h4><ul className="mt-2 flex flex-wrap gap-2">{history.owner_change_dates.map((entry, index) => <li key={index} className="rounded-lg bg-[var(--ac-surface-2)] px-3 py-1">{date(entry)}</li>)}</ul></div>}
      {history.plate_history !== null && history.plate_history.length > 0 && <div className="mt-4"><h4 className="text-sm font-bold">Регистрационная история</h4><ol className="mt-2 space-y-2">{history.plate_history.map((entry, index) => <li key={index} className="min-w-0 rounded-xl bg-[var(--ac-surface-2)] p-3"><Facts rows={[
        ['Дата', date(entry.date)], ['Использование', entry.use], ['Вид автомобиля', entry.vehicle_kind],
      ]}/></li>)}</ol></div>}
      {history.uninsured_periods !== null && history.uninsured_periods.length > 0 && <div className="mt-4"><h4 className="text-sm font-bold">Периоды без страхования по отчёту</h4><ul className="mt-2 space-y-1 text-sm">{history.uninsured_periods.map((entry, index) => <li key={index}>{month(entry.from)} — {month(entry.to)}</li>)}</ul></div>}
    </section>
  </div>;
}

function TextMap({values}: {values: Record<string, string>}) {
  return <Facts rows={Object.entries(values)}/>;
}

function Groups({title, values}: {title: string; values: Record<string, Record<string, string>> | null}) {
  if (!values || !Object.values(values).some(group => Object.keys(group).length)) return null;
  return <section className="mt-4 min-w-0"><h4 className="text-sm font-bold">{title}</h4>{Object.entries(values).filter(([, group]) => Object.keys(group).length).map(([label, group]) => <details key={label} className="mt-2 min-w-0 rounded-xl border border-[var(--ac-border)] p-3">
    <summary className="min-w-0 cursor-pointer break-words text-sm font-bold [overflow-wrap:anywhere]">{label}</summary>
    <TextMap values={group}/>
  </details>)}</section>;
}

function Codes({values}: {values: Record<string, string | string[]> | null}) {
  if (!values || !Object.keys(values).length) return null;
  return <details className="mt-3 min-w-0 rounded-xl border border-[var(--ac-border)] p-3">
    <summary className="cursor-pointer text-sm font-bold">Обозначения деталей из отчёта</summary>
    <Facts rows={Object.entries(values).map(([key, value]) => [key, Array.isArray(value) ? value.length ? value.join(', ') : 'Нет отметки' : value])}/>
    <p className="mt-2 text-xs leading-5 text-[var(--ac-muted)]">Обозначения приведены как в отчёте.</p>
  </details>;
}

function Inspection({inspection, diagnosis}: {inspection: PaidKoreaInspection | null; diagnosis: PaidKoreaDiagnosis | null}) {
  if (!inspection && !diagnosis) return <p role="status" className="text-sm leading-6">Сведения об осмотре и диагностике не предоставлены.</p>;
  return <div className="min-w-0 space-y-5" data-paid-korea-inspection>
    <section className="min-w-0">
      <h3 className="text-base font-bold">Осмотр автомобиля</h3>
      {inspection ? <>
        <Facts rows={[
          ['Номер отчёта', inspection.record_number], ['Дата выдачи', date(inspection.issue_date)],
          ['Начало действия', date(inspection.valid_from)], ['Окончание действия', date(inspection.valid_until)],
          ['Первая регистрация', date(inspection.first_registration_date)], ['Модельный год', number(inspection.model_year)],
          ['Пробег при осмотре', inspection.mileage === null ? unavailable : `${number(inspection.mileage)} км`],
          ['Код двигателя', inspection.engine_code], ['Вид гарантии', inspection.warranty_type],
          ['ДТП по осмотру', flag(inspection.accident)], ['Ремонт наружных панелей', flag(inspection.simple_repair)],
          ['Затопление', flag(inspection.flood)], ['Особая история', labels(inspection.special_history)],
          ['Отзывная кампания', flag(inspection.recall)], ['Отзывная кампания выполнена', flag(inspection.recall_completed)],
          ['Тюнинг', flag(inspection.tuning)], ['Виды тюнинга', labels(inspection.tuning_types)],
          ['Изменение назначения', labels(inspection.usage_changes)], ['Одометр', inspection.odometer_state],
          ['Оценка пробега', inspection.mileage_assessment], ['Состояние маркировки VIN', inspection.vin_state],
          ['CO', inspection.co_percent === null ? unavailable : `${number(inspection.co_percent)} %`],
          ['HC', inspection.hc_ppm === null ? unavailable : `${number(inspection.hc_ppm)} ppm`],
          ['Дымность', inspection.smoke_percent === null ? unavailable : `${number(inspection.smoke_percent)} %`],
        ]}/>
        <Groups title="Кузов и силовые элементы" values={inspection.panels}/>
        <Groups title="Системы автомобиля" values={inspection.systems}/>
        <Codes values={inspection.panel_codes}/>
      </> : <p className="mt-2 text-sm text-[var(--ac-muted)]">Документ осмотра не предоставлен.</p>}
    </section>
    <section className="min-w-0">
      <h3 className="text-base font-bold">Диагностика</h3>
      {diagnosis ? <>
        <Facts rows={[
          ['Дата диагностики', date(diagnosis.date)], ['Центр диагностики', diagnosis.center], ['Результат', diagnosis.result],
        ]}/>
        {diagnosis.panels && Object.keys(diagnosis.panels).length > 0 && <div className="mt-3"><h4 className="text-sm font-bold">Отметки по деталям</h4><TextMap values={diagnosis.panels}/></div>}
        <Codes values={diagnosis.panel_codes}/>
      </> : <p className="mt-2 text-sm text-[var(--ac-muted)]">Сведения о диагностике не предоставлены.</p>}
    </section>
    <p className="text-xs leading-5 text-[var(--ac-muted)]">Осмотр и диагностика отражают сведения на дату их проведения. Они не заменяют страховую историю и независимую проверку автомобиля.</p>
  </div>;
}

export function PaidKoreaReportContent({report}: {report: PaidKoreaReport}) {
  return <>
    {report.kind === 'history' ? <History history={report.history}/> : <Inspection inspection={report.inspection} diagnosis={report.diagnosis}/>}
    <p className="mt-4 text-xs text-[var(--ac-muted)]">Сведения получены {date(report.observedAt.slice(0, 10))}.</p>
  </>;
}

function ReportSection({offerId, lot, kind, title}: {offerId: string; lot: string; kind: PaidKoreaReportKind; title: string}) {
  const [open, setOpen] = useState(false), [started, setStarted] = useState(false);
  const [report, setReport] = useState<PaidKoreaReport | null>(null);
  const [error, setError] = useState<'missing' | 'unavailable' | null>(null);
  const [attempt, setAttempt] = useState(0);
  const requested = useRef(false), contentId = useId();
  useEffect(() => {
    if (!started || requested.current) return;
    requested.current = true;
    setError(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('timeout'), 25000);
    let mounted = true;
    const query = new URLSearchParams({id: offerId, lot, kind});
    fetch(`/api/catalog/korea-report?${query}`, {signal: controller.signal, credentials: 'same-origin', cache: 'no-store'})
      .then(async response => {
        if (response.status === 404) { if (mounted) setError('missing'); return; }
        if (!response.ok) throw new Error('report');
        const value: unknown = await response.json();
        if (!validPaidKoreaReport(value, offerId, lot, kind)) throw new Error('report');
        if (mounted) setReport(value);
      })
      .catch(() => { if (mounted) setError('unavailable'); })
      .finally(() => clearTimeout(timer));
    // Closing either disclosure preserves a single pending request and its result.
    return () => { mounted = false; clearTimeout(timer); controller.abort(); requested.current = false; };
  }, [offerId, lot, kind, attempt, started]);

  return <section className="mt-4 min-w-0 overflow-hidden rounded-xl border border-[var(--ac-border)]" data-korea-report-section={kind}>
    <button type="button" aria-expanded={open} aria-controls={contentId} onClick={() => { setStarted(true); setOpen(value => !value); }} className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-red-400">
      {title}<ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}/>
    </button>
    <div id={contentId} hidden={!open} className="min-w-0 border-t border-[var(--ac-border)] p-3 sm:p-4">
      {started && !report && !error && <p role="status" className="text-sm text-[var(--ac-muted)]">Загружаем отчёт…</p>}
      {error && <div className="text-sm"><p role="status">{error === 'missing' ? 'Для этого автомобиля сведения не предоставлены.' : 'Не удалось загрузить отчёт. Попробуйте ещё раз позже.'}</p><button type="button" onClick={() => { requested.current = false; setAttempt(value => value + 1); }} className="mt-3 min-h-11 rounded-xl bg-[var(--ac-surface-2)] px-4 py-2 font-bold outline-none focus-visible:ring-2 focus-visible:ring-red-400">Повторить</button></div>}
      {report && <PaidKoreaReportContent report={report}/>}
    </div>
  </section>;
}

export default function PaidKoreaReportPanel({offerId, lot, active}: {offerId: string; lot: string; active: boolean}) {
  return <section aria-label="История и состояние" className="min-w-0 rounded-2xl border border-[var(--ac-border)] p-4 text-[var(--ac-text)] sm:p-5" data-korea-report-panel data-paid-korea-report-panel data-active={active}>
    <h2 className="text-lg font-bold">История и состояние</h2>
    <p className="mt-2 text-sm leading-6 text-[var(--ac-muted)]">Выберите отчёт: страховая история, осмотр или диагностика.</p>
    <p className="mt-2 text-xs leading-5 text-[var(--ac-muted)]">Отсутствие сведений не подтверждает отсутствие повреждений. Перед покупкой состояние автомобиля нужно проверить.</p>
    <ReportSection key={`${offerId}:${lot}:history`} offerId={offerId} lot={lot} kind="history" title="Страховая история"/>
    <ReportSection key={`${offerId}:${lot}:inspection`} offerId={offerId} lot={lot} kind="inspection" title="Осмотр автомобиля"/>
  </section>;
}
