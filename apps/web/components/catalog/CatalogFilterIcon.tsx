import {BadgeCheck, Car, CarFront, Globe, Settings2, Route, Droplet, ArrowDownUp} from "lucide-react";
const icons = {make: BadgeCheck, model: CarFront, market: Globe, bodyType: Car, transmission: Settings2, drive: Route, fuel: Droplet, sort: ArrowDownUp};
export function CatalogFilterIcon({name}:{name:string}) {
 const Icon=icons[name as keyof typeof icons];
 return Icon ? <Icon className="ac-filter-leading-icon" size={17} strokeWidth={1.7} aria-hidden="true"/> : null;
}
