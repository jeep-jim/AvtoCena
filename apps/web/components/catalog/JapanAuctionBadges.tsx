import { auctionGradeLabel, japanRestrictionDescription, type JapanExportRestriction } from "../../lib/catalog/japan-export-restriction";

export function JapanAuctionBadges({ offer, dense = false }: { offer: { auctionGrade?: unknown; japanExportRestriction?: JapanExportRestriction }; dense?: boolean }) {
  const grade = auctionGradeLabel(offer.auctionGrade);
  const restriction = japanRestrictionDescription(offer.japanExportRestriction);
  if (!grade && !restriction) return null;
  const gradeColor = grade && /^(R|RA|RB|\*)/.test(grade) ? "bg-[#be3545]" : grade && Number(grade) < 4 ? "bg-[#f5ad29] ac-japan-badge--amber" : "bg-[#7751d2]";
  return <span className={`flex shrink-0 flex-col items-end gap-1 ${dense ? "text-[8px] sm:text-[10px]" : "text-[10px]"}`}>
    {restriction ? <span title={restriction} className="ac-japan-badge whitespace-nowrap rounded-md bg-[#be3545] px-2 py-1 font-bold leading-none">Санкционный</span> : null}
    {grade ? <span title="Оценка аукциона по данным источника" className={`ac-japan-badge whitespace-nowrap rounded-md px-2 py-1 font-bold leading-none ${gradeColor}`}>Оценка {grade}</span> : null}
  </span>;
}
