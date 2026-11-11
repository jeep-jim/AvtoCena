/** Shared body classification for compact search rows and full offer cards.
 * Body shape never certifies M1/N1, gross weight or customs eligibility. */
type Carrier = {make?:unknown;year?:unknown;model?:unknown;trim?:unknown;sourceTitle?:unknown;bodyType?:unknown;editorialSpecifications?:{bodyType?:unknown}};
const text=(value:unknown)=>String(value||'').normalize('NFKC').toLowerCase().replace(/[‐‑–—]/g,'-').replace(/\s+/g,' ').trim();
const families:Array<[RegExp,RegExp]>=[
  [/toyota|тойота/,/\b(?:hilux|tacoma|tundra)\b/],
  [/ford|форд/,/\b(?:ranger|f[ -]?150)\b/],
  [/volkswagen|vw/,/\bamarok\b/],
  [/mitsubishi/,/\b(?:l[ -]?200|triton)\b/],
  [/nissan/,/\b(?:navara|frontier|np300|titan)\b/],
  [/isuzu/,/\b(?:d[ -]?max|re[ -]?max|ruimai)\b/],
  [/chevrolet/,/\b(?:colorado|silverado|s10)\b/],
  [/gmc/,/\b(?:sierra|canyon)\b/],
  [/jeep/,/\bgladiator\b/],
  [/^(?:ram|dodge)$/, /\b(?:ram\s*)?(?:1500|2500|3500)\b/],
  [/ssang\s*yong|kgm|kg mobility/,/\b(?:rexton\s+sports|musso\s+(?:grand|sports|khan))\b|렉스턴\s*스포츠|무쏘\s*스포츠/],
  [/great wall|gwm/,/\b(?:poer|pao|cannon|wingle|king kong)\b/],
  [/honda/,/\bridgeline\b/],
  [/hyundai/,/\bsanta cruz\b/],
  [/renault/,/\balaskan\b/],
  [/mazda/,/\bbt[ -]?50\b/],
  [/peugeot/,/\blandtrek\b/],
  [/maxus|ldv/,/\b(?:t60|t70|t90)\b/],
 ];
export function catalogPickupBody(offer:Carrier):boolean {
 const body=text(offer.editorialSpecifications?.bodyType||offer.bodyType);
 // A combined source bucket is not evidence of a pickup by itself.
 if(/^(?:pick[ -]?up|пикап|皮卡|픽업|pickup truck)$/.test(body))return true;
 if(offer.editorialSpecifications?.bodyType)return false;
 const make=text(offer.make),identity=text([offer.model,offer.trim,offer.sourceTitle].filter(Boolean).join(' '));
 if(/\bhilux\s+(?:surf|sport runner)\b/.test(identity))return false;

 if(/ssang\s*yong|kgm|kg mobility/.test(make)&&Number(offer.year)>=2018&&/^musso(?:\s|$)/.test(identity))return true;
 if(/^ford$/.test(make)&&Number(offer.year)>=2021&&/^maverick(?:\s|$)/.test(identity))return true;
 if(families.some(([brand,model])=>brand.test(make)&&model.test(identity)))return true;
 return /\b(?:pick[ -]?up|double cab|single cab|crew cab)\b|пикап|皮卡|픽업/.test(identity);
}
export function catalogBodyType(offer:Carrier):string {
 return catalogPickupBody(offer)?'pickup':String(offer.editorialSpecifications?.bodyType||offer.bodyType||'');
}

/** Broad source candidates, then catalogBodyType performs the precise check.
 * These are WHERE predicates, not a cap or a list of allowed public makes. */
export function pickupSourceCandidateSql(stock:boolean){
 const fragments=['HILUX','TACOMA','TUNDRA','RANGER','F-150','F150','F 150','AMAROK','L200','L-200','L 200','TRITON','NAVARA','FRONTIER','NP300','TITAN','D-MAX','D MAX','DMAX','RE-MAX','RE MAX','REMAX','RUIMAI','COLORADO','SILVERADO','S10','SIERRA','CANYON','GLADIATOR','1500','2500','3500','REXTON','MUSSO','렉스턴','무쏘','POER','PAO','CANNON','WINGLE','KING KONG','RIDGELINE','SANTA CRUZ','ALASKAN','BT-50','BT 50','BT50','LANDTREK','T60','T70','T90','MAVERICK','PICKUP','PICK-UP','PICK UP','DOUBLE CAB','SINGLE CAB','CREW CAB','ПИКАП','皮卡','픽업'];
 const clauses=fragments.flatMap(value=>['model_name','grade'].map(column=>`${column} like '%${value}%'`));
 // Stock INFO contains the source body label even for an unfamiliar model.
 if(stock)for(const value of ['pickup','pick-up','pick up','пикап','皮卡','픽업'])clauses.push(`info like '%${value}%'`);
 return '('+clauses.join(' or ')+')';
}
