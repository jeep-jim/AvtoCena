import './NavigationBadge.css';
export function NavigationBadge({count}:{count:number}){
 return count>0?<span className="crm-navigation-badge" aria-hidden="true" title={`Новых действий: ${count}`}>{count>99?'99+':count}</span>:null;
}
