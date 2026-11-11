"use client";
import { auctionGradeColorClass } from "@/lib/catalog/auction-grade-color";

export type SelectedFilter = { key: string; label: string; grade?: string };

export function SelectedFilterChip({ chip, onRemove }: { chip: SelectedFilter; onRemove: (key: string) => void }) {
  return <button type="button" aria-label={`Убрать ${chip.label}`} onClick={() => onRemove(chip.key)} className={`${chip.grade ? `ac-japan-badge ${auctionGradeColorClass(chip.grade)}` : "ac-filter-chip"} flex min-h-8 max-w-full items-center gap-1.5 rounded-full px-3 text-xs font-black`}><span className="truncate">{chip.label}</span><span aria-hidden="true" className="text-base leading-none opacity-55">×</span></button>;
}
