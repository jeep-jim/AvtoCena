import type {ModelSummary} from './schema';
import type {CompactSpecs} from './compact';
export type DirectoryModel=Omit<ModelSummary,'key'|'markets'|'revision'|'updatedAt'|'verified'|'power30'|'variants'|'photoMarket'>;
type WireModel=Omit<DirectoryModel,'compact'> & {spec?:number;yearSpecs?:Record<string,number>};
export type DirectoryWire={models:WireModel[];specs:CompactSpecs[]};
// Shared year summaries are sent once, not repeated for every model/year.
export function packDirectory(models:DirectoryModel[]):DirectoryWire{
 const specs:CompactSpecs[]=[],keys=new Map<string,number>();
 const index=(value:CompactSpecs)=>{const key=JSON.stringify(value);let i=keys.get(key);if(i===undefined){i=specs.length;keys.set(key,i);specs.push(value);}return i;};
 return {specs,models:models.map(({compact,...model})=>({...model,...(compact?{spec:index(compact.all),yearSpecs:Object.fromEntries(Object.entries(compact.years).map(([year,spec])=>[year,index(spec)]))}:{})}))};
}
export function unpackDirectory({models,specs}:DirectoryWire):DirectoryModel[]{return models.map(({spec,yearSpecs,...model})=>({...model,...(spec===undefined?{}:{compact:{all:specs[spec],years:Object.fromEntries(Object.entries(yearSpecs||{}).map(([year,i])=>[year,specs[i]]))}})}));}
