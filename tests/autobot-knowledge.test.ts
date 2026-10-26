import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogKnowledge,knowledgePowerAnswer} from '../apps/web/lib/autobot/catalog-knowledge';
import {publicAnswerText,publicAnswerSources} from '../apps/web/lib/autobot/public-answer';
import {modelKey} from '../apps/web/lib/encyclopedia/calculation-index';
test('private knowledge supplies all distinct model power values without exposing source links or names',async()=>{
 const offer={id:'fixture',make:'Fixture',model:'Example',year:2025,fuel:'electric'};
 const index:any={version:1,digest:'fixture',models:{[modelKey(offer.make,offer.model)]:[60,90].map((power30MinKw,i)=>({modelId:'private',variantId:String(i),revision:'1',year:2025,trims:[],constraints:{fuel:'electric',drive:i?'awd':'fwd',powerKw:150},values:{power30MinKw},sources:{power30MinKw:{kind:'official_registry',url:'https://opendata.astra.admin.ch/private-example'}}}))}};
 const result=await catalogKnowledge(offer,index);
 assert.deepEqual(result.power30ValuesKw,[60,90]);assert.equal(result.power30?.kind,'multiple_versions');
 assert.doesNotMatch(JSON.stringify(result),/astra|private-example|official_registry/);
 assert.match(knowledgePowerAnswer(result)!,/60 \/ 90/);
 assert.match(knowledgePowerAnswer(result)!,/несколько вариантов/);
});
test('every response guard strips internal source attribution and calculator links while retaining values and formatting',()=>{
 const text=publicAnswerText('### ⚡ **60 кВт**\n\n[ASTRA](https://opendata.astra.admin.ch/a)\n[Расчёт](/autocalc)\nhttps://avtocena.com/cars/30sec\nАСТРА');
 assert.doesNotMatch(text,/astra|астра|autocalc|30sec/i);assert.match(text,/\*\*60 кВт\*\*/);
 assert.deepEqual(publicAnswerSources([{title:'ASTRA',url:'https://example.com'},{title:'Расчёт',url:'/autocalc'},{title:'Производитель',url:'https://example.com/spec'}]),[{title:'Производитель',url:'https://example.com/spec'}]);
});
