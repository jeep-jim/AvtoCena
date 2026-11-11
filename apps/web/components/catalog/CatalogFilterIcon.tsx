import {ArrowDownUp} from "lucide-react";
import {SpecIcon, type SpecIconName} from "./OfferSpecTile";
const icons:Record<string,SpecIconName>={bodyType:"body",transmission:"transmission",drive:"drive",fuel:"fuel"};
export function CatalogFilterIcon({name}:{name:string}) {
 if(name==="sort")return <ArrowDownUp className="ac-filter-leading-icon" size={17} strokeWidth={1.7} aria-hidden="true"/>;
 return icons[name]?<SpecIcon name={icons[name]} className="ac-filter-leading-icon"/>:null;
}
