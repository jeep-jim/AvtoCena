export function initialSearchQuery(prompt) {
 if(typeof prompt!=='string'||!prompt.trim()||prompt.length>2500)throw Error('invalid_message');
 // The web API includes a long consultation preamble. Search uses the same
 // vehicle question as the existing external link, not that chat preamble.
 const question=prompt.match(/Вопрос: ([\s\S]*?)\. Проверь точную модификацию/);
 return (question?.[1]||prompt).trim();
}
export function researchSearchUrl(context, followup='') {
 if(typeof followup!=='string'||followup.length>2500)throw Error('invalid_message');
 const url=new URL('https://yandex.ru/search/');
 url.searchParams.set('text',followup.trim()?`${context}. ${followup.trim()}`:context);
 return url.toString();
}
