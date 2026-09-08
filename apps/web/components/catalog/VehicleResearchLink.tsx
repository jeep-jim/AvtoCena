import { vehicleResearchUrl, type VehicleResearchIdentity } from "../../lib/catalog/vehicle-research-link";

export function VehicleResearchLink({ identity }: { identity: VehicleResearchIdentity }) {
  const href = vehicleResearchUrl(identity);
  if (!href) return null;
  return <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 max-w-full items-center gap-1 py-2 text-xs font-semibold text-[var(--ac-muted)] underline underline-offset-4 hover:text-red-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" title="Поиск в Яндексе. Проверьте модификацию и источник перед вводом данных.">
    Уточнить характеристики в Яндексе <span aria-hidden="true">↗</span>
  </a>;
}
