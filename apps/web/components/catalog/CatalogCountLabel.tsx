import {formatCatalogCount} from "@/lib/catalog/count-format";

export function CatalogCountLabel({total,countIncomplete}:{total:number;countIncomplete?:boolean}){
 return <span><span>Найдено: </span> {countIncomplete?'не менее ':''}<span className="whitespace-nowrap tabular-nums" data-catalog-result-value>{formatCatalogCount(total)}</span></span>;
}
