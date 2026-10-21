import { auctionGradeRows } from "../../lib/catalog/auction-guide";

// Broad reference supplied for reading the sheet; houses use different legends.
const damageRows = [
 ["A1 / A2 / A3", "Царапина: небольшая / средняя / большая"],
 ["E1 / E2 / E3", "Небольшие вмятины: одна / несколько / много"],
 ["U1 / U2 / U3", "Вмятина: небольшая / средняя / большая"],
 ["W1 / W2 / W3", "Следы ремонта или покраски: слабозаметные / заметные / выраженные"],
 ["S1 / S2", "Ржавчина: небольшая / выраженная"],
 ["C1 / C2", "Коррозия: небольшая / выраженная"],
 ["P", "Отличие цвета окраски"], ["H", "Ухудшение лакокрасочного покрытия"],
 ["X", "Элемент требует замены"], ["XX", "Элемент заменён"],
 ["B1 / B2 / B3", "Вмятина с царапиной: небольшая / средняя / большая"],
 ["Y1 / Y2 / Y3", "Трещина или разрыв: небольшой / средний / большой"],
 ["G", "Скол от камня на стекле"],
 ["X1 / R / RX", "Обозначения повреждений и ремонта стекла — сверяйте с легендой площадки"],
] as const;

export function AuctionSheetHelp({ kind }: { kind: "grades" | "damage" }) {
 return <section data-auction-help className="rounded-2xl bg-[var(--ac-surface)] p-4 text-[var(--ac-text)]">
  <h2 className="text-base font-black">{kind === "grades" ? "Аукционные оценки" : "Повреждения на схеме"}</h2>
  <p className="mt-2 text-xs leading-5 text-[var(--ac-muted)]">Шкалы и обозначения площадок различаются. Приоритет — у оригинального листа и комментариев инспектора.</p>
  <dl className="mt-2 text-xs leading-5">
   {kind === "grades" ? auctionGradeRows.map(([label,description,tone]) => <div key={label} className="flex items-start gap-3 border-b border-[var(--ac-border)] py-2.5"><dt className={`ac-grade-guide-chip--${tone} min-w-12 shrink-0 rounded-lg px-2 py-1 text-center font-bold`}>{label}</dt><dd>{description}</dd></div>)
    : damageRows.map(([code,description]) => <div key={code} className="border-b border-[var(--ac-border)] py-2"><dt className="font-black">{code}</dt><dd className="text-[var(--ac-muted)]">{description}</dd></div>)}
  </dl>
 </section>;
}
