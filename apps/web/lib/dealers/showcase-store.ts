import {mergeShowcaseChanges} from './showcase-merge';
import {dealerProfilePath} from './profile-url';
import { readDataJson, mutateDataJson } from "../data";
import {
  defaultShowcase,
  normalizeShowcase,
  PILOT_DEALER_ID,
  type DealerShowcase,
} from "./showcase-model";
export function validDealerId(id: string) {
  return /^[a-zA-Z0-9_-]{1,80}$/.test(id) && !id.includes("__");
}
export async function findDealer(id: string) {
  if (!validDealerId(id)) return null;
  const rows = await readDataJson<any[]>("dealers/dealers.json", []);
  return (
    (rows.length ? rows : [{ id: PILOT_DEALER_ID, name: "TopAvto", status:"verified" }]).find(
      (d) => d.id === id,
    ) || null
  );
}
export async function readShowcase(id: string) {
  const dealer = await findDealer(id);
  if (!dealer) return null;
  const base=defaultShowcase(id,dealer.name);
  const stored=await readDataJson<DealerShowcase>(`dealers/showcases/${id}.json`,base);
  return {...base,...stored,pricing:{...base.pricing,...stored.pricing}};
}
export class ShowcaseConflict extends Error {
 constructor(public current:DealerShowcase,public proposed:DealerShowcase){super("Настройки изменились в другой вкладке. Ваши данные сохранены в редакторе.");}
}
export async function resolveDealerProfile(city:string,slug:string){
 const index=await readDataJson<Record<string,string>>("dealers/profile-links.json",{});
 return index[`/${city}/${slug}`] || (city==='nvkz'&&slug==='topavto'?PILOT_DEALER_ID:null);
}
export async function saveShowcase(id:string,raw:any){
 if(!(await findDealer(id)))throw Error("Компания не найдена");
 let saved!:DealerShowcase;
 await mutateDataJson<DealerShowcase>(`dealers/showcases/${id}.json`,defaultShowcase(id),async current=>{
  let candidate=raw;
  if(current.version!==raw.version){
   if(!raw.base || raw.base.dealerId!==id || raw.base.version!==raw.version)throw new ShowcaseConflict(current,raw);
   const merged=mergeShowcaseChanges(raw.base,raw,current);
   if(merged.conflicts.length)throw new ShowcaseConflict(current,merged.value);
   candidate=merged.value;
  }
  saved=normalizeShowcase(candidate,id,current.version+1);
  const url=dealerProfilePath(saved);
  if(!url.startsWith('/dealers/'))await mutateDataJson<Record<string,string>>('dealers/profile-links.json',{},index=>{
   if(index[url]&&index[url]!==id)throw Error("Эта ссылка уже занята другим дилером");
   if(url==='/nvkz/topavto'&&id!==PILOT_DEALER_ID)throw Error("Эта ссылка уже занята другим дилером");
   return {...index,[url]:id};
  });
  return saved;
 });
 return saved;
}
export type PublicFeatures = { version: number; affiliatesEnabled: boolean };
export function readPublicFeatures() {
  return readDataJson<PublicFeatures>("settings/public-features.json", {
    version: 0,
    affiliatesEnabled: true,
  });
}
export async function savePublicFeatures(raw: PublicFeatures) {
  let saved!: PublicFeatures;
  await mutateDataJson<PublicFeatures>(
    "settings/public-features.json",
    { version: 0, affiliatesEnabled: true },
    (current) => {
      if (current.version !== raw.version)
        throw Error("Настройки сервисов изменились. Обновите страницу");
      saved = {
        version: current.version + 1,
        affiliatesEnabled: raw.affiliatesEnabled === true,
      };
      return saved;
    },
  );
  return saved;
}
