import {getJsonStorage} from '../apps/web/lib/data';
async function main(){
 const saved:any=await getJsonStorage().readJson('catalog/partner-cache/ajes/china/83A7S2UuaVtzRx.json',null),lot=saved?.items?.[0];
 const text=String(lot?.info||'');
 const lines=text.replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
 const names=lines.filter(l=>l.includes(':')).map(l=>l.slice(0,l.indexOf(':')).trim()).filter(l=>l.length<=120);
 const safe=/^(?:engine model|maximum horsepower \(ps\)|maximum power\s*\(kw\)|net power\s*\(kw\)|displacement\s*\((?:ml|l)\)|fuel form|body structure|body type|gearbox|transmission|drive mode|driving method|length\s*[×x*\/]\s*width|length \(mm\)|width \(mm\)|height \(mm\)|wheelbase \(mm\)|number of seats|number of doors|fuel tank volume \(l\)|vehicle warranty|engine turbo)$/i;
 const technical=lines.filter(l=>safe.test(l.slice(0,l.indexOf(':')).trim())).map(l=>({name:l.slice(0,l.indexOf(':')).trim(),value:l.slice(l.indexOf(':')+1).trim().slice(0,180)}));
 console.log('SAVED_HAVAL_DETAIL',JSON.stringify({found:!!lot,observedAt:saved?.observedAt,lot:lot?.lot,sourceTemplate:lot?.status,price:lot?.sourcePrice,names,technical}));
}
main().catch(()=>{console.log('SAVED_HAVAL_DETAIL_FAILED');process.exitCode=1;});
