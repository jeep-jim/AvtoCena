type AjesMarket='china'|'korea'|'japan';
type SourceDecision=(market:AjesMarket,source?:string)=>Promise<boolean>;
type Scope={renderedMarkets:readonly string[];directMarket:string;directSource:string;preparedChina:boolean;omitLegacyChina:boolean};

/** Query only source-routing controls the current surface can actually use.
 * This makes a selected local market independent of an unrelated source's
 * control/manifest I/O. It does not fetch inventory or change the selected
 * source, catalog result, or a prepared generation. */
export async function readCatalogRouteSourceScope(
 {renderedMarkets,directMarket,directSource,preparedChina,omitLegacyChina}:Scope,
 decide:SourceDecision,
){
 if(preparedChina)return {liveChina:false,liveKorea:false,direct:false};
 const china=directMarket==='china' || (!omitLegacyChina&&renderedMarkets.includes('china'));
 const korea=directMarket==='korea' || renderedMarkets.includes('korea');
 const [liveChina,liveKorea,directJapan]=await Promise.all([
  china?decide('china',directMarket==='china'?directSource:undefined):false,
  korea?decide('korea',directMarket==='korea'?directSource:undefined):false,
  directMarket==='japan'?decide('japan',directSource):false,
 ]);
 return {liveChina,liveKorea,direct:directMarket==='china'?liveChina:directMarket==='korea'?liveKorea:directJapan};
}
