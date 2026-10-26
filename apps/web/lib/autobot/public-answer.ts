/** Last-mile vocabulary guard: preserve numbers and meaning, hide implementation labels. */
export function publicAnswerText(text:string){
 return text.replace(/\[[^\]]+\]\(https?:\/\/[^)]*astra[^)]*\)/gi,'наша база').replace(/\[([^\]]+)\]\((?:https?:\/\/[^/)]+)?\/(?:autocalc|cars\/30sec)[^)]*\)/gi,'расчёт в карточке автомобиля').replace(/https?:\/\/[^\s)]*astra[^\s)]*/gi,'наша база').replace(/(?:https?:\/\/(?:www\.)?avtocena\.com)?\/(?:autocalc|cars\/30sec)(?:[?#][^\s]*)?/gi,'расчёт в карточке автомобиля').replace(/\bASTRA\b|АСТРА/gi,'наша база').replace(/`/g,'').replace(/calculationStatus\s*[:=]\s*["']?needs_data["']?/g,'для расчёта не хватает параметров')
 .replace(/totalRub\s*[:=]\s*null/g,'итоговая цена пока не рассчитана')
 .replace(/readPages\s*[:=]\s*0/g,'подтверждение в источниках не получено')
 .replace(/\bneeds_data\b/g,'нужны параметры для расчёта').replace(/\btotalRub\b/g,'итоговая цена')
 .replace(/\bcalculationStatus\b/g,'готовность расчёта').replace(/\breadPages\b/g,'прочитанные источники')
 .replace(/\bnull\b/g,'не указано').replace(/\bsourcePrice\b/g,'цена продавца').replace(/\bsourceCurrency\b/g,'валюта цены');
}

export function publicAnswerSources(sources:{title:string;url:string}[]){return sources.filter(s=>!/(?:astra|autocalc|cars\/30sec)/i.test(s.url+' '+s.title));}
