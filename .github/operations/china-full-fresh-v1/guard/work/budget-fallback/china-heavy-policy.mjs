// One-release China publisher guard. Do not change the policy of protected markets.
const decimal=/^(?:\d{1,5}(?:[.,]\d{1,3})?)$/;
const norm=x=>String(x??'').normalize('NFKC').trim();
const grossLabel=/^(?:最大允许总质量|最大总质量|总质量|车辆总质量|车輛總質量|最大允許總質量|最大總質量|總質量|차량\s*총중량|총중량|полная\s+масса(?:\s+автомобиля)?|разреш[её]нная\s+(?:максимальная\s+)?масса|максимально\s+разреш[её]нная\s+масса|(?:maximum\s+)?(?:permitted\s+)?gross\s+(?:vehicle\s+)?(?:weight|mass)(?:\s+rating)?|gvwr)(?:\s*[(\[]\s*(?:kg|кг|公斤|千克|킬로그램)\s*[)\]])?$/iu;
const kg=/\bkg\b|кг|公斤|千克|킬로그램/iu;
const classLabel=/^(?:级别|級別|车身结构|車身結構|车辆类型|車輛類型|тип кузова|класс автомобиля|body type|vehicle type|vehicle category)$/iu;
const machinery=/\b(?:forklift|excavator|bulldozer|tractor|machinery|road\s+roller|crane truck|grader|backhoe)\b|погрузчик|экскаватор|бульдозер|трактор|автокран|спецтехник|工程机械|工程機械|挖掘机|挖掘機|叉车|叉車|推土机|推土機|压路机|壓路機/iu;
const truck=/\b(?:truck|lorry|tipper|semi[ -]?truck|prime\s+mover|dump\s+truck)\b|грузовик|грузовой автомобиль|货车|貨車|卡车|卡車|轻卡|輕卡|微卡|牵引车|牽引車|自卸车|自卸車/iu;
const bus=/\b(?:bus|minibus|coach|motorcoach)\b|автобус|микроавтобус|巴士|公交车|公交車|公交客车|公交客車|(?:大|中)型客车|(?:大|中)型客車|客运大巴|客運大巴|大巴车|大巴車/iu;
const pickup=/\bpick[ -]?up\b|пикап|皮卡/iu;
const passengerVan=/\b(?:minivan|mpv|passenger\s+van|light\s+van)\b|минивэн|минивен|пассажирский фургон|多用途乘用车|多用途乘用車/iu;
function measure(v,unitRequired=false,label=''){
 if(typeof v!=='number'&&typeof v!=='string')return;
 const s=norm(v);if(unitRequired&&!kg.test(label+' '+s))return;
 const clean=s.replace(/(?:\s*(?:kg|кг|公斤|千克|킬로그램))$/iu,'').trim()
  .replace(/^(\d{1,2})[ ,](\d{3})$/u,'$1$2');
 if(!decimal.test(clean))return;
 const n=Number(clean.replace(',','.'));if(Number.isFinite(n)&&n>0&&n<=100000)return n;
}
function snapshotItems(row){
 const s=row?.operational?.sourceSpecifications;
 const id=norm(row?.sourceOfferId);
 if(!s||!id||s.sourceId!==row.sourceId||norm(s.sourceOfferId)!==id||!Array.isArray(s.groups))return [];
 return s.groups.flatMap(g=>Array.isArray(g?.items)?g.items:[]);
}
export function chinaHeavyPolicyReason(row,{knownHeavyFamily=()=>false}={}){
 if(row?.market!=='china')return null;
 const items=snapshotItems(row);
 const exact=[];
 const direct=measure(row.grossVehicleWeightKg);if(direct!==undefined)exact.push(direct);
 const ev=row.operational?.semanticEvidence?.grossVehicleWeightKg;
 if(ev?.status==='exact'){const n=measure(ev.value);if(n!==undefined)exact.push(n);}
 for(const i of items){const label=norm(i?.name);if(grossLabel.test(label)){const n=measure(i?.value,true,label);if(n!==undefined)exact.push(n);}}
 if(exact.some(n=>n>3500))return 'china_overweight_gvwr';
 const declared=[row.bodyType,row.vehicleType,row.bodyClass,...items.filter(i=>classLabel.test(norm(i?.name))).map(i=>i.value)].map(norm).filter(Boolean);
 const identity=[row.make,row.model,row.trim].map(norm).join(' ');
 const body=declared.join(' '),text=(identity+' '+body).trim(),category=norm(row.vehicleCategory).toUpperCase();
 if(knownHeavyFamily(row.make,row.model))return 'china_known_heavy_family';
 if(machinery.test(text))return 'china_special_machinery';
 // M2/M3 are explicit legal bus/coach categories, N2/N3 explicit truck.
 // N1, passenger-van shape and seat count alone are not exclusions.
 if(/^M[23]G?$/u.test(category)||bus.test(text))return 'china_bus';
 if(/^N[23]G?$/u.test(category))return 'china_truck';
 if(truck.test(body)&&!(/^(?:pickup\s+truck|pick-up\s+truck)$/iu.test(body.trim())||(pickup.test(body)&&!truck.test(body.replace(/\bpick[ -]?up\s+truck\b/igu,'')))))return 'china_truck';
 if(truck.test(identity)&&!pickup.test(text)&&!passengerVan.test(body))return 'china_truck';
 return null;
}
