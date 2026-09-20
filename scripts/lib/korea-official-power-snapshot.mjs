import {createHash} from 'node:crypto';
const clean=value=>String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim();
export function buildOfficialPowerSnapshot(rows,previous,{capturedAt,rawSha256,unitHtml}) {
 if(!Array.isArray(rows)||rows.length<3000||rows.length<previous.records.length*0.9)throw Error('official_power_snapshot_collapse');
 if(!/최고출력\s*\(ps\/rpm\)/i.test(unitHtml)||!unitHtml.includes('TOP_OUT'))throw Error('official_power_unit_unverified');
 const records=rows.map(row=>({id:clean(row.RECP_NO),manufacturer:clean(row.COMP_NM),model:clean(row.MODL_NM),
   engineCode:clean(row.ENG_TYPE),engineCc:Number(row.BAEGI_AMT)||0,fuel:clean(row.FUEL_KIND_NM),
   powertrain:clean(row.CAR_TYPE_NM||row.TYPE_GB_NM),output:clean(row.TOP_OUT),releaseDate:clean(row.OPEN_DT),releaseYear:Number(row.OPEN_YY)||0}));
 if(records.filter(row=>row.id&&row.engineCode&&row.output&&row.engineCc).length<2000)throw Error('official_power_fields_missing');
 // Keep historical disagreements: a missing or changed rating must not turn an
 // ambiguous engine family into an apparently unanimous one on the next run.
 const unique=new Map([...previous.records,...records].map(row=>[JSON.stringify(row),row]));
 return {...previous,capturedAt,rawSha256,previousSnapshotSha256:previous.rawSha256,
   unitPageSha256:createHash('sha256').update(unitHtml).digest('hex'),records:[...unique.values()]};
}
