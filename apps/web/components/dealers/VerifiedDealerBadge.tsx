import {BadgeCheck} from 'lucide-react';
export function VerifiedDealerBadge(){
 return <details className="dealer-verification relative inline-flex shrink-0 text-emerald-500"><summary className="cursor-pointer list-none rounded-full [&::-webkit-details-marker]:hidden" aria-label="Проверенный дилер" title="Проверенный дилер"><BadgeCheck size={22}/></summary><span className="absolute right-0 top-8 z-50 w-56 rounded-xl bg-[var(--ac-surface)] p-3 text-xs font-medium text-[var(--ac-text)] shadow-xl">Проверенный дилер — компания прошла проверку АвтоЦены.</span></details>;
}
