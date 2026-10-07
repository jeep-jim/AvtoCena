/** Transport interruptions may retry the same page; access refusals must stop. */
export function sourceTransportFailure(message) {
 const text=String(message||'');
 if (/(?:401|403|429|captcha|bot.?challenge|access.?block)/i.test(text)) return false;
 return /^terminated$/i.test(text.trim()) || /timeout|timed.?out|abort|network|fetch failed|econnreset|http[_: ]5\d\d|yandex_bridge_non_json_5\d\d|transient(?:[_: ]status)?[_: ]202/i.test(text);
}
