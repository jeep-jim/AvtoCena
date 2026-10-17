// Confirmed Haval identity: GWM annual report 2021 and export Jolion model.
// Alias changes names only; it never transfers engines, trims or power between markets.
const haval=/^(?:haval|哈弗|хавал|хавейл)$/i;
export function internationalModel(make:unknown,model:unknown){
 const value=String(model??'').normalize('NFKC').trim();
 if(!haval.test(String(make??'').trim()))return value;
 return value.replace(/^(?:(?:haval|哈弗|хавал|хавейл)\s*)?(?:first[\s-]+love|chu[\s-]*lian|初恋|julion|jolion|джолион|джулион)(?=$|[\s-])/i,'Jolion');
}
