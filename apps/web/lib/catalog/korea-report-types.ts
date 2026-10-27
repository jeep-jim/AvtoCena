import {koreaBodyParts,koreaBodyConditions} from './korea-inspection-schema';
import type {KoreaReportDocument} from './korea-report-document';
export type KoreaSourceReportKind = 'history' | 'inspection';
export type KoreaReportLink = {version: 2; offerId: string; lot: string; kind: KoreaSourceReportKind; href: string; originalHref: string; document?: KoreaReportDocument | null};

/** Shared validation: only supplier report URLs, never arbitrary frames or redirects. */
export function exactKoreaReportUrl(value: unknown, lot: string, kind: KoreaSourceReportKind): string | null {
 if (typeof value !== 'string' || value.length > 2048 || !/^\d{6,10}$/.test(lot)) return null;
 let url: URL; try { url = new URL(value); } catch { return null; }
 if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
 if (kind === 'history' && url.hostname === 'fem.encar.com' && url.pathname === `/cars/report/accident/${lot}` && !url.search) return url.href;
 if (kind === 'inspection' && url.hostname === 'www.encar.com' && url.pathname === '/md/sl/mdsl_regcar.do' && url.searchParams.get('method') === 'inspectionViewNew' && url.searchParams.get('carid') === lot && [...url.searchParams.keys()].length === 2) return url.href;
 return null;
}
export function koreaWrapperUrl(value: unknown): string | null {
 if (typeof value !== 'string' || value.length > 600) return null;
 let url: URL; try { url = new URL(value); } catch { return null; }
 return url.protocol === 'https:' && url.hostname === 'tru.ru' && !url.port && !url.username && !url.password && !url.search && !url.hash && /^\/korea\/[A-Za-z0-9_-]{20,512}$/.test(url.pathname) ? url.href : null;
}
export function validKoreaReportLink(value: unknown, offerId: string, lot: string, kind: KoreaSourceReportKind): value is KoreaReportLink {
 if (!value || typeof value !== 'object') return false;
 const v = value as KoreaReportLink;
 if(v.document!=null&&!validKoreaReportDocument(v.document,lot,kind))return false;
 return v.version === 2 && v.offerId === offerId && v.lot === lot && v.kind === kind && Boolean(exactKoreaReportUrl(v.originalHref, lot, kind)) && (v.href === v.originalHref || Boolean(koreaWrapperUrl(v.href)));
}

function validKoreaReportDocument(value:unknown,lot:string,kind:KoreaSourceReportKind):boolean{
 if(!value||typeof value!=='object')return false;
 const d=value as KoreaReportDocument;
 if(d.version!==1||d.lot!==lot||d.kind!==kind||kind!=='inspection'||d.partial!==true||!Array.isArray(d.fields)||d.fields.length>80)return false;
 const keys=new Set<string>();
 for(const field of d.fields){
  if(!field||typeof field!=='object'||typeof field.key!=='string'||field.key.length>200||keys.has(field.key)||typeof field.label!=='string'||field.label.length>180||typeof field.value!=='string'||field.value.length>300||field.group!==undefined&&(typeof field.group!=='string'||field.group.length>80))return false;
  keys.add(field.key);
 }
 if(d.body!==undefined){
  if(!d.body||typeof d.body.unmapped!=='boolean'||!Array.isArray(d.body.parts)||d.body.parts.length>40)return false;
  const parts=new Set<string>();
  for(const part of d.body.parts){
   if(!part||typeof part.key!=='string'||!Object.hasOwn(koreaBodyParts,part.key)||parts.has(part.key)||!Array.isArray(part.conditions)||part.conditions.length>6||new Set(part.conditions).size!==part.conditions.length||part.conditions.some(c=>typeof c!=='string'||!Object.hasOwn(koreaBodyConditions,c)))return false;
   parts.add(part.key);
  }
 }
 return true;
}
