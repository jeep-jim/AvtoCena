const reserved=new Set(['api','crm','admin','cars','auto','dealers','login','auth','privacy','terms','cookies','consent','results','favorites','autocalc','internal','telegram','mini','request','requisites','partner','osago','credit','mcp','sitemap','robots','health','settings','staff','_next']);
export function validProfilePart(value:string){return /^[a-z][a-z0-9-]{1,39}$/.test(value)&&!reserved.has(value);}
export function dealerProfilePath(s:{dealerId:string;citySlug?:string;slug?:string}){
 return s.citySlug&&s.slug&&validProfilePart(s.citySlug)&&validProfilePart(s.slug)?`/${s.citySlug}/${s.slug}`:`/dealers/${s.dealerId}`;
}
