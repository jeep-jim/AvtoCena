import {formatCatalogCount} from "@/lib/catalog/count-format";

export function CatalogCountLabel({total,countIncomplete}:{total:number;countIncomplete?:boolean}){
 if(countIncomplete)return <span>Общее количество уточняется</span>;
 return <span><span className="whitespace-nowrap tabular-nums" data-catalog-result-value>{formatCatalogCount(total)}</span><span className="ac-catalog-count-unit"> авто</span></span>;
}
