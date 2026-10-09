import {translateCatalogText} from './presentation';
export function isChinaModelSpecification(offer:any){
 return offer?.market==='china'&&(offer.catalogEntryKind==='model_variant'||offer.sourceId==='autohome_new_china_open'||offer.sourceGroup==='autohome_new_china_open');
}
/** The model name is intentionally short; keep the actual trim visible separately. */
export function chinaCardVariant(offer:any){
 if(offer?.market!=='china'||!offer.trim)return '';
 let value=String(offer.trim).normalize('NFKC').replace(/^\s*(?:19|20)\d{2}\s*(?:款|Model\s*)?/i,'');
 const seats=(n:string)=>`${n} ${Number(n)%10===1&&Number(n)%100!==11?"место":[2,3,4].includes(Number(n)%10)&&![12,13,14].includes(Number(n)%100)?"места":"мест"} `;
 const phrases:Array<[RegExp,string]>=[
  [/\bComfort(?:\s+(?:Type|Edition))?\b/gi,'Комфорт '],
  [/\bLuxury(?:\s+(?:Type|Edition))?\b/gi,'Люкс '],
  [/\bPremium(?:\s+(?:Type|Edition))?\b/gi,'Премиум '],
  [/\bFlagship(?:\s+(?:Type|Edition))?\b/gi,'Флагман '],
  [/\bElite(?:\s+(?:Type|Edition))?\b/gi,'Элит '],
  [/\bDelight Edition\b/gi,'Делайт '],
  [/\bIntelligent Drive Edition\b/gi,'Интеллектуальное вождение '],
  [/高级营运/g,'Коммерческая, высший класс '],[/中级营运/g,'Коммерческая, средний класс '],
  [/增程版/g,'Гибрид REEV '],[/纯电版/g,'Электро '],[/柴油/g,'дизель '],[/汽油/g,'бензин '],
  [/劲享[型版]?/g,'Jinxiang '],[/劲尚[型版]?/g,'Jinshang '],[/劲锐[型版]?/g,'Jinrui '],
  [/商旅[型版]?/g,'Туристическая '],[/商务[型版]?/g,'Бизнес '],[/尊贵[型版]?/g,'Престиж '],
  [/舒适[型版]?/g,'Комфорт '],[/豪华[型版]?/g,'Люкс '],[/畅享[型版]?/g,'Чансян '],
  [/舒享[型版]?/g,'Комфорт '],[/尊荣[型版]?/g,'Престиж '],[/行政[型版]?/g,'Бизнес '],
  [/尊享[型版]?/g,'Премиум '],[/旗舰[型版]?/g,'Флагман '],[/精英[型版]?/g,'Элит '],
  [/标准[型版]?/g,'Стандарт '],[/领先[型版]?/g,'Лидер '],[/时尚[型版]?/g,'Стиль '],
  [/四驱/g,'4WD '],[/两驱/g,'2WD '],[/前驱/g,'передний привод '],[/后驱/g,'задний привод '],
  [/手动/g,'МКПП '],[/自动/g,'АКПП '],[/厢车/g,'фургон '],
 ];
 value=value.replace(/(\d+)座/g,(_,n)=>seats(n)).replace(/\b(\d+)[ -]seaters?\b/gi,(_,n)=>seats(n));
 for(const [pattern,text] of phrases)value=value.replace(pattern,text);
 return translateCatalogText(value).replace(/\s+/g,' ').trim();
}
