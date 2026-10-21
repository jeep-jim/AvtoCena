import { auctionGradeLabel } from './japan-export-restriction';

/** Shared by cards and the selected auction-grade filter. */
export function auctionGradeColorClass(value: unknown): string {
  const grade = auctionGradeLabel(value);
  if (!grade) return '';
  if (/^(R|RA|RB|\*)/.test(grade)) return 'ac-grade-guide-chip--red';
  if (Number(grade) < 4) return 'ac-grade-guide-chip--amber ac-japan-badge--amber';
  return grade === '4' || grade === '4.5' ? 'ac-grade-guide-chip--green' : 'ac-grade-guide-chip--violet';
}
