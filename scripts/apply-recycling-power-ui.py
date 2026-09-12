from pathlib import Path

changes = {}
def replace(path, old, new):
    text = changes.get(path, Path(path).read_text())
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected one anchor, found {count}: {old[:100]!r}')
    changes[path] = text.replace(old, new, 1)

card = 'apps/web/components/catalog/CatalogCard.tsx'
replace(card, 'import { ElectricMotorIcon }', '''import { recyclingPowerInfo } from "../../lib/catalog/recycling-power";
import { RecyclingPowerLabel } from "./RecyclingPower";
import powerStyles from "./RecyclingPower.module.css";
import { ElectricMotorIcon }''')
replace(card, '  const powerScenario = readCatalogPowerScenario(normalizedOffer);', '  const powerScenario = readCatalogPowerScenario(normalizedOffer);\n  const powerInfo = powerScenario ? null : recyclingPowerInfo(normalizedOffer);')
replace(card, 'className={`flex flex-nowrap overflow-x-auto whitespace-nowrap font-bold text-white/58', 'className={`${powerInfo?.borderline ? powerStyles.wrapChips : ""} flex flex-nowrap overflow-x-auto whitespace-nowrap font-bold text-white/58')
replace(card, '<span className={tagClass}><PowerIcon dense={dense} /><span>{o.powerHp} л.с.</span></span>', '<span className={`${tagClass} ${powerInfo?.borderline ? powerStyles.warningChip : ""}`} title={powerInfo?.reason} data-recycling-power-chip={powerInfo?.borderline || undefined}><PowerIcon dense={dense} /><RecyclingPowerLabel hpLabel={`${o.powerHp} л.с.`} info={powerInfo} showKw={Boolean(powerInfo?.borderline)} /></span>')

inline = 'apps/web/components/catalog/InlineOfferParameters.tsx'
replace(inline, 'import { ElectricMotorIcon }', '''import { recyclingPowerInfo } from "../../lib/catalog/recycling-power";
import { RecyclingPowerLabel, RecyclingPowerExplanation, RecyclingFeeHelp } from "./RecyclingPower";
import powerStyles from "./RecyclingPower.module.css";
import { ElectricMotorIcon }''')
replace(inline, 'powerHp:"мощность",', 'powerHp:"мощность",powerKw:"мощность в кВт",')
replace(inline, 'function Tile({label,value,icon,children,wide=false}:{label:string;value:string;icon:ReactNode;children:ReactNode;wide?:boolean})', 'function Tile({label,value,valueNode,warning=false,icon,children,wide=false}:{label:string;value:string;valueNode?:ReactNode;warning?:boolean;icon:ReactNode;children:ReactNode;wide?:boolean})')
replace(inline, 'className="flex h-12 cursor-pointer list-none items-center gap-3 py-2 pl-4 pr-4 text-left [&::-webkit-details-marker]:hidden"', 'className={`flex h-12 cursor-pointer list-none items-center gap-3 py-2 pl-4 pr-4 text-left [&::-webkit-details-marker]:hidden ${valueNode ? powerStyles.powerTile : ""} ${warning ? powerStyles.warningTile : ""}`}')
replace(inline, 'className="min-w-0 flex-1 break-words text-xs font-bold">{value}</span>', 'className="min-w-0 flex-1 break-words text-xs font-bold">{valueNode ?? value}</span>')
# Closing the absolutely positioned editor on pointerdown used to shrink the
# scroll extent before pointerup and swallow the first tap on Reset on mobile.
replace(inline, 'const close=(event:PointerEvent)=>', 'const close=(event:MouseEvent)=>')
replace(inline, 'document.addEventListener("pointerdown",close);document.addEventListener("keydown",escape);', 'document.addEventListener("click",close);document.addEventListener("keydown",escape);')
replace(inline, 'document.removeEventListener("pointerdown",close);document.removeEventListener("keydown",escape);', 'document.removeEventListener("click",close);document.removeEventListener("keydown",escape);')
replace(inline, '...(key==="fuel"?{hybridKind:"",icePowerKw:"",power30MinKw:""}:{})', '...(key==="powerHp"?{powerKw:""}:{}),...(key==="powerKw" && Number(value)>0?{powerHp:String(Math.round(Number(value)/0.73549875))}:{}),...(key==="fuel"?{hybridKind:"",icePowerKw:"",power30MinKw:"",powerKw:""}:{})')
replace(inline, ' const showCalculation=dirty || Boolean(result);', ''' const showCalculation=dirty || Boolean(result);
 const powerInfo = recyclingPowerInfo({powerHp:draft.powerHp,powerKw:draft.powerKw,fuel:draft.fuel,vehicleCategory:draft.vehicleCategory,powertrainKind:draft.fuel==="hybrid"?draft.hybridKind:draft.fuel==="electric"?"electric":"combustion"});
 const powerLabel = draft.powerHp ? `${draft.powerHp} л.с.` : "Указать мощность";
 const pairedPower = Boolean(powerInfo?.borderline);''')
replace(inline, '''   <Tile label="Мощность" value={draft.powerHp?`${draft.powerHp} л.с.`:"Указать мощность"} icon={<Zap size={16}/>}>
    {field("powerHp","Мощность, л.с.",[50,75,90,100,120,140,150,160,180,200,250,300,400,500],1,2500)}
   </Tile>''', '''   <Tile label="Мощность" value={`${powerLabel}${pairedPower && powerInfo ? ` / ${powerInfo.kwLabel}` : ""}`} valueNode={pairedPower ? <RecyclingPowerLabel hpLabel={powerLabel} info={powerInfo} showKw /> : undefined} warning={pairedPower} icon={<Zap size={16}/>}>
    {powerInfo?.borderline ? <RecyclingPowerExplanation info={powerInfo} /> : null}
    {field("powerHp","Мощность, л.с.",[50,75,90,100,120,140,150,160,180,200,250,300,400,500],1,2500)}
    {!["electric","hybrid"].includes(draft.fuel) ? <>
      {field("powerKw","Мощность, кВт (если известна)",[],0.1,2000)}
      <p className="text-xs leading-5 text-[var(--ac-muted)]">Если кВт указаны, расчёт использует их без округления до л.с. Изменение л.с. очищает прежние кВт. Если в источнике только 160 л.с., точные кВт нужно уточнить перед оплатой.</p>
    </> : null}
   </Tile>''')
replace(inline, '<dt>{row.label||row.title||row.id}</dt><dd>', '<dt>{row.label||row.title||row.id}{/utilization|утил/i.test(`${row.id} ${row.title||row.label||""}`) ? <RecyclingFeeHelp info={powerInfo} /> : null}</dt><dd className="shrink-0 whitespace-nowrap">')

page = 'apps/web/app/(public)/cars/offer/[id]/page.tsx'
replace(page, 'import { translatedSpecificationGroups }', '''import { recyclingPowerInfo, type RecyclingPowerInfo } from "@/lib/catalog/recycling-power";
import { RecyclingFeeHelp } from "@/components/catalog/RecyclingPower";
import { translatedSpecificationGroups }''')
replace(page, 'function OfferPriceBreakdown({ offer }: { offer: any })', 'function OfferPriceBreakdown({ offer, powerInfo }: { offer: any; powerInfo: RecyclingPowerInfo | null })')
replace(page, '{money(line.amountRub)} ₽</span></div>)}</div>', '{money(line.amountRub)} ₽</span>{/utilization|утил/i.test(`${line.id} ${line.title}`) ? <div className="col-span-2"><RecyclingFeeHelp info={powerInfo} /></div> : null}</div>)}</div>')
replace(page, 'powerHp:powerScenario?.source==="fallback_100"?"":String(safePowerHp||""),hybridKind:', 'powerHp:powerScenario?.source==="fallback_100"?"":String(safePowerHp||""),powerKw:powerScenario?"":String(recyclingPowerInfo(raw)?.kw||""),hybridKind:')
replace(page, '<OfferPriceBreakdown offer={o} />', '<OfferPriceBreakdown offer={o} powerInfo={recyclingPowerInfo(raw)} />')

params = 'apps/web/lib/catalog/customer-parameters.ts'
replace(params, '  const month = input?.productionMonth', '''  // Preserve explicit kW when another parameter changes. Never turn 118 kW into
  // 117.6798 kW by reconstructing it from the rounded display value 160 hp.
  const explicitKw = powertrainKind === "combustion" && input?.powerKw != null && input.powerKw !== ""
    ? number("powerKw",0.1,2000) : undefined;
  const calculationHp = explicitKw == null ? powerHp : explicitKw / 0.73549875;
  const month = input?.productionMonth''')
replace(params, 'year,fuel,powerHp,powerKw:powerHp == null ? undefined : powerHp * 0.73549875,powertrainKind,', 'year,fuel,powerHp:calculationHp,powerKw:explicitKw ?? (powerHp == null ? undefined : powerHp * 0.73549875),powertrainKind,')

sync = 'apps/web/lib/catalog/combustion-power-consistency.ts'
replace(sync, '  const kw = Number((Number(offer.powerHp) * 0.73549875).toFixed(5));', '''  const hpKw = Number(offer.powerHp) * 0.73549875;
  // Validated customer kW produces an unrounded matching hp value. Keep its
  // original precision; still replace genuinely stale, conflicting kW copies.
  const suppliedKw = Number(offer.powerKw);
  const kw = String(offer.powerDataSource || "") === "customer_input" && suppliedKw > 0 && Number.isFinite(suppliedKw) && Math.abs(suppliedKw - hpKw) < 1e-8
    ? suppliedKw : Number(hpKw.toFixed(5));''')
engine = 'packages/engine/src/calculation/russiaCustoms.ts'
replace(engine, 'const PERSONAL_COMBUSTION_LIMIT_KW = 117.68;', 'export const PERSONAL_COMBUSTION_LIMIT_KW = 117.68;')

for path, text in changes.items():
    Path(path).write_text(text)
print('Applied narrow replacements to', len(changes), 'existing files.')

# Read-only sample of the public catalog contract; no stored data is changed.
import json, urllib.request
try:
    url = 'https://avtocena.com/api/catalog/search?market=china&make=Volkswagen&model=T-Roc&pageSize=20'
    with urllib.request.urlopen(url, timeout=20) as response:
        data = json.load(response)
    keys = ('id','powerHp','powerKw','icePowerKw','vehicleCategory','tnVedCode','powertrainKind','fuel')
    rows = [{**{k:r.get(k) for k in keys}, 'calculatedCategory':r.get('calculationSnapshot',{}).get('customs',{}).get('vehicleCategory')} for r in data.get('items',[])]
    Path('artifacts/recycling-power').mkdir(parents=True,exist_ok=True)
    Path('artifacts/recycling-power/production-input.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
    print('PUBLIC_POWER_INPUT',json.dumps(rows,ensure_ascii=False))
except Exception as error:
    print('Public input probe unavailable:',str(error))
