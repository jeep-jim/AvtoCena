import { auctionGradeLabel } from './japan-export-restriction';

/** Shared by cards and the selected auction-grade filter. */
export function auctionGradeColorClass(value: unknown): string {
  const grade = auctionGradeLabel(value);
  if (!grade) return '';
  if (/^(R|RA|RB|\*)/.test(grade)) return 'bg-[#be3545]';
  if (Number(grade) < 4) return 'bg-[#f5ad29] ac-japan-badge--amber';
  return grade === '4' || grade === '4.5' ? 'ac-grade-guide-chip--green' : 'bg-[#7751d2]';
}
