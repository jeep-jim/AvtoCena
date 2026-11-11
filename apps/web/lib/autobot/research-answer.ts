/** A literal variant + power row in a read specification can be reported without generation. */
export function researchPowerReply(results:any[],question:string){
 if(!/мощ|power/i.test(question)||/(30|тридцат|рассч|посчита|сравн|стоимост|бюджет|подбер)/i.test(question))return null;
 if(new Set((question.match(/\b\d{2}\s*(?:TFSI|TDI)\b/gi)||[]).map(s=>s.replace(/\s+/g,'').toUpperCase())).size!==1)return null;
 const variant=question.match(/\b(\d{2})\s*(TFSI|TDI)\b/i);if(!variant)return null;
 const re=new RegExp('\\b'+variant[1]+'\\s*'+variant[2]+'\\b','i');
 for(const result of results)for(const page of result.web?.pages||[]){
  if(!['manufacturer','document'].includes(page.kind))continue;
  for(const line of String(page.text||'').split(/\n/)){
   const at=line.search(re);if(at<0)continue;
   const nearby=line.slice(at,at+150);if((nearby.match(/\b\d{2}\s*(?:TFSI|TDI)\b/gi)||[]).length!==1)continue;
   const found=nearby.match(/\b(\d+(?:[.,]\d+)?)\s*(kW|кВт|hp|PS|л\.\s?с)(?![\p{L}]|\s*[·*]\s*ч)/iu);if(!found)continue;
   const value=Number(found[1].replace(',','.'));if(!(value>0&&value<=2500))continue;
   const power=/^(kW|кВт)$/i.test(found[2])?value+' кВт (≈'+Math.round(value*1.3596216173)+' л.с.)':value+' '+found[2];
   const title=String(page.title||'Спецификация производителя').replace(/[<>\[\]()*_`]/g,'');
   return 'В ['+(page.kind==='manufacturer'?'официальной спецификации':'прочитанном документе')+']('+page.url+') для **'+variant[1]+' '+variant[2].toUpperCase()+'** указано **'+power+'**.\n\nИсточник: '+title+'. '+'Это справочные данные источника. Применимость именно к указанному году, рынку и комплектации этим ответом не подтверждена. Параметры карточки не изменены.';
  }
 }
 return null;
}
/** Preserve completed research if answer generation fails, without inventing a specification. */
export function researchFallbackReply(results:any[],question:string){
 const native=results.find(r=>r.web?.searchEvidence?.answer&&r.web.searchEvidence.sources?.length)?.web.searchEvidence;if(native)return native.answer;
 const pages=[...new Map(results.flatMap(r=>r.web?.pages||[]).map(p=>[p.url,p])).values()] as any[];
 const preferred=pages.filter(p=>p.kind==='manufacturer'||p.kind==='document');
 const selected=(preferred.length?preferred:pages).slice(0,3);
 const plain=(value:unknown)=>String(value||'').replace(/[<>\[\]()*_`]/g,'').replace(/\s+/g,' ').trim();
 if(!selected.length){const links=results.flatMap(r=>r.web?.webSearch?.links||[]).slice(0,2);return 'Поисковые запросы выполнены, но получить читаемые материалы не удалось. Это не означает, что сведений в интернете нет.'+(links.length?'\n\n'+links.map(l=>'['+plain(l.title)+']('+l.url+')').join('\n'):'');}
 const thirty=/(30|тридцат)/i.test(question);const requested=question.match(/\b(\d{2})\s*(TFSI|TDI)\b/i);const requestedRe=requested?new RegExp('\\b'+requested[1]+'\\s*'+requested[2]+'\\b','i'):null;
 const lines=selected.map(p=>{const line=String(p.text||'').split(/\n|(?<=[.;])\s+/).find(l=>(!requestedRe||requestedRe.test(l))&&/\d[\d., ]*\s*(?:kW|кВт|hp|PS|л\.\s?с)(?![\p{L}])/iu.test(l));const at=line?.search(/\d[\d., ]*\s*(?:kW|кВт|hp|PS|л\.\s?с)(?![\p{L}])/iu)??0;const quote=!thirty&&(p.kind==='manufacturer'||p.kind==='document')&&line?plain(line.slice(Math.max(0,at-60),at+120)).split(/\s+/).slice(0,20).join(' '):'';return '- ['+plain(p.title)+']('+p.url+')'+(quote?' — фрагмент: «'+quote+'».':'');});
 return 'Найдены материалы, но завершить пояснение не удалось. Ссылки на прочитанные источники:\n\n'+lines.join('\n')+'\n\n'+(thirty?'30-минутная мощность этим ответом не подтверждена; пиковая её не заменяет.':'Фрагменты относятся к указанным источникам; соответствие году, рынку и точной комплектации здесь не подтверждено.')+' Параметры автомобиля не изменены.';
}
