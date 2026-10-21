/** Non-car makes and explicit source vehicle classes; never engine-size guesses. */
const nonCarMakes=['YAMAHA','KAWASAKI','DUCATI','HARLEY-DAVIDSON','HARLEY DAVIDSON','TRIUMPH','HUSQVARNA','APRILIA','MOTO GUZZI','MV AGUSTA','ROYAL ENFIELD','INDIAN','VESPA','BIMOTA','BUELL','ZERO MOTORCYCLES'];
const clean=(value:unknown)=>String(value||'').normalize('NFKC').trim().toUpperCase();
export function motorcycleExcluded(offer:any){
 if(nonCarMakes.includes(clean(offer.make)))return true;
 if(/^L[1-7](?:E(?:-[A-Z0-9]+)?)?$/i.test(clean(offer.vehicleCategory)))return true;
 return /(?:\b(?:motorcycle|motorbike|scooter|moped|quadbike|atv)\b|мотоцикл|мотороллер|скутер|мопед|квадроцикл|摩托车|摩托車|オートバイ|二輪|오토바이)/i.test([offer.bodyType,offer.vehicleType,offer.model,offer.trim].join(' '));
}
export function motorcycleSqlExclusion(){return `marka_name not in (${nonCarMakes.map(make=>"'"+make+"'").join(',')})`;}
