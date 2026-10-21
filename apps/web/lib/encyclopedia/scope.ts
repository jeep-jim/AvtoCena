// Owner-selected passenger automotive directory. Original revisions remain archived.
const key=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const excludedMakes=new Set([
 'Harley-Davidson','Harley Davidson','Yamaha','Ducati','Kawasaki','Aprilia','Husqvarna',
 'Triumph Motorcycles','Royal Enfield','Bajaj','Benelli','MV Agusta','Moto Guzzi','Zero Motorcycles',
 'Can-Am','BRP','Polaris','Vanderhall','JCB','Massey Ferguson','Kubota','Caterpillar',
 'Ashok Leyland','Eicher','Hino','Mitsubishi Fuso','SML Isuzu',
].map(key));
const excludedModels:Record<string,string[]>={
 brabus:['1300 R - KTM 1300'],ktm:['1300R'],tata:['LPO 1618','LPO 916'],isuzu:['NQR'],mitsubishi:['Fuso Rosa'],toyota:['Fork lift'],
};
export function isEncyclopediaCar(row:{make:string;model:string}){
 const make=key(row.make);return !excludedMakes.has(make)&&!(excludedModels[make]||[]).some(model=>key(model)===key(row.model));
}
