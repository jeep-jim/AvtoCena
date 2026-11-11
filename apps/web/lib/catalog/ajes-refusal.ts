/** Classify short supplier refusals without retaining a body that may echo credentials. */
export function ajesRefusalCode(text:string):string|null{
 if(Buffer.byteLength(text)>256)return null;
 const clean=text.replace(/^\uFEFF/,'').trim();
 if(!clean||/^[\[\{<"]/.test(clean))return null;
 const direct=clean.match(/^((?:bot|ban)\d*)(?:\s|$)/i);
 if(direct)return direct[1].length<=16?direct[1].toLowerCase():'ban';
 // Live HTTP200 responses on 11 Nov contained a short non-JSON ban/limit
 // message, without the old "botN password" prefix. Do not retry another
 // query for the same visitor or misclassify this refusal as corrupt JSON.
 if(/\bban\b/i.test(clean)&&/\blimit\b/i.test(clean))return 'ban_limit';
 return null;
}
