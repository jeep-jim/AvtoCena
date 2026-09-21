import { auctionGradeLabel, japanRestrictionDescription, type JapanExportRestriction } from "../../lib/catalog/japan-export-restriction";
import { AuctionGradeGuide } from "./AuctionGradeGuide";
import { auctionGradeColorClass } from '../../lib/catalog/auction-grade-color';

export function JapanAuctionBadges({ offer, dense = false, interactive = false, hideRestriction = false }: { offer: { auctionGrade?: unknown; japanExportRestriction?: JapanExportRestriction }; dense?: boolean; hideRestriction?: boolean; interactive?: boolean }) {
  const grade = auctionGradeLabel(offer.auctionGrade);
  const restriction = !hideRestriction && japanRestrictionDescription(offer.japanExportRestriction);
  if (!grade && !restriction) return null;
  const gradeColor = auctionGradeColorClass(grade);
  return <span className={`relative flex shrink-0 flex-col items-end gap-1 ${dense ? "text-[8px] sm:text-[10px]" : "text-[10px]"}`}>
    {restriction ? <span title={restriction} className={`ac-japan-badge whitespace-nowrap rounded-md bg-[#be3545] px-2 py-1 font-bold leading-none ${interactive ? "" : "absolute bottom-full right-0 mb-1.5"}`}>Санкции</span> : null}
    {grade ? interactive ? <AuctionGradeGuide grade={grade} className={`ac-japan-badge whitespace-nowrap rounded-md px-2 py-1 font-bold leading-none ${gradeColor}`} /> : <span title="Оценка аукциона по данным источника" className={`ac-japan-badge whitespace-nowrap rounded-md px-2 py-1 font-bold leading-none ${gradeColor}`}>Оценка {grade}</span> : null}
  </span>;
}
