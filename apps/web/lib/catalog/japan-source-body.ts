const bodies:Readonly<Record<string,string>>=Object.freeze({
  suv:'suv',crossover:'suv','кроссовер':'suv',
  offroad:'offroad','off-road':'offroad','внедорожник':'offroad',
  sedan:'sedan',saloon:'sedan','седан':'sedan',
  hatchback:'hatchback','хэтчбек':'hatchback',
  wagon:'wagon',estate:'wagon','station wagon':'wagon','универсал':'wagon',
  minivan:'minivan',mpv:'minivan','минивэн':'minivan',
  coupe:'coupe','купе':'coupe',convertible:'convertible',cabriolet:'convertible','кабриолет':'convertible',
  pickup:'pickup','pick-up':'pickup','pick up':'pickup','пикап':'pickup',
  van:'van','фургон':'van',
});
/** The complete labels understood by this parser, for conservative source
 * candidate compilation. The final local parser remains authoritative. */
export function japanSourceBodyLabels(selected:readonly string[]):string[]{
 return Object.keys(bodies).filter(label=>selected.includes(bodies[label]));
}
/** Explicit supplier body labels only. A chassis code, model name or equipment
 * word is not a body type. Keep unknown and combined categories unresolved. */
export function japanSourceBody(value:unknown):string|undefined {
 if(typeof value!=='string')return;
 const label=value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
 return Object.hasOwn(bodies,label)?bodies[label]:undefined;
}
