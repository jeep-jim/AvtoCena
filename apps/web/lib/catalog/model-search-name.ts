import {internationalModel} from './international-model';
/** Discovery aliases only. Never change stored identity or transfer specifications.
 * Honda calls this family STEP WGN: https://www.honda.co.jp/STEPWGN/
 * The Green Corner feed uses STEPWGN; the shared selector uses STEP WAGON.
 */
export function modelSearchName(make:unknown,model:unknown):string {
 const value=internationalModel(make,model);
 if(!/^(?:honda|ホンダ|хонда)$/i.test(String(make??'').trim()))return value;
 return value.replace(/^(?:step[\s-]*(?:wagon|wgn)|ст[еэ]п[\s-]*вагон)(?=$|[\s-])/i,'STEPWGN');
}
