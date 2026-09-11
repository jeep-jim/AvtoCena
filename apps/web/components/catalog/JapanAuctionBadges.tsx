import { auctionGradeLabel, japanRestrictionDescription, type JapanExportRestriction } from "../../lib/catalog/japan-export-restriction";
import { AuctionGradeGuide } from "./AuctionGradeGuide";

export function JapanAuctionBadges({ offer, dense = false, interactive = false }: { offer: { auctionGrade?: unknown; japanExportRestriction?: JapanExportRestriction }; dense?: boolean; interactive?: boolean }) {
  const grade = auctionGradeLabel(offer.auctionGrade);
  const restriction = japanRestrictionDescription(offer.japanExportRestriction);
  if (!grade && !restriction) return null;
  const gradeColor = grade && /^(R|RA|RB|\*)/.test(grade) ? "bg-[#be3545]" : grade && Number(grade) < 4 ? "bg-[#f5ad29] ac-japan-badge--amber" : grade === "4" || grade === "4.5" ? "ac-grade-guide-chip--green" : "bg-[#7751d2]";
  return <span className={`relative flex shrink-0 flex-col items-end gap-1 ${dense ? "text-[8px] sm:text-[10px]" : "text-[10px]"}`}>
    {restriction ? <span title={restriction} className={`ac-japan-badge whitespace-nowrap rounded-md bg-[#be3545] px-2 py-1 font-bold leading-none ${interactive ? "" : "absolute bottom-full right-0 mb-1.5"}`}>Санкционный</span> : null}
    {grade ? interactive ? <AuctionGradeGuide grade={grade} className={`ac-japan-badge whitespace-nowrap rounded-md px-2 py-1 font-bold leading-none ${gradeColor}`} /> : <span title="Оценка аукциона по данным источника" className={`ac-japan-badge whitespace-nowrap rounded-md px-2 py-1 font-bold leading-none ${gradeColor}`}>Оценка {grade}</span> : null}
  </span>;
}
