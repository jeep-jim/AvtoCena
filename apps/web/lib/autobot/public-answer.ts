/** Last-mile vocabulary guard: preserve numbers and meaning, hide implementation labels. */
export function publicAnswerText(text:string){
 return text.replace(/`/g,'').replace(/calculationStatus\s*[:=]\s*["']?needs_data["']?/g,'для расчёта не хватает параметров')
 .replace(/totalRub\s*[:=]\s*null/g,'итоговая цена пока не рассчитана')
 .replace(/readPages\s*[:=]\s*0/g,'подтверждение в источниках не получено')
 .replace(/\bneeds_data\b/g,'нужны параметры для расчёта').replace(/\btotalRub\b/g,'итоговая цена')
 .replace(/\bcalculationStatus\b/g,'готовность расчёта').replace(/\breadPages\b/g,'прочитанные источники')
 .replace(/\bnull\b/g,'не указано').replace(/\bsourcePrice\b/g,'цена продавца').replace(/\bsourceCurrency\b/g,'валюта цены');
}
