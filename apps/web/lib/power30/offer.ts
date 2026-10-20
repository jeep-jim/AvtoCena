import type {VehicleOffer} from "../catalog/types";
import {classifySpecificationEvidence} from "../catalog/specification-evidence-audit";
import {catalogOfferTitle} from "../catalog/presentation";
import {offerPath} from "../catalog/offer-url";
import {emptyPower30Inputs, type Power30Car, type Power30Kind} from "./calculator";
const positive = (value:unknown,max=2000) => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= max ? value : undefined;
export function power30Kind(offer:Partial<VehicleOffer>):Power30Kind {
  const fuel = String(offer.fuel || "").toLowerCase();
  if (offer.powertrainKind === "electric" || /^(electric|bev|электро)$/.test(fuel)) return "BEV";
  if (/^(phev|plug.?in hybrid)$/.test(fuel)) return "PHEV";
  if (/^(mhev|mild hybrid)$/.test(fuel)) return "MHEV";
  if (offer.powertrainKind === "series_hybrid") return "unknown";
  // A generic hybrid label does not distinguish HEV from PHEV/MHEV.
  if (offer.powertrainKind === "other_hybrid" || /hybrid|гибрид|hev/.test(fuel)) return fuel === "hev" ? "HEV" : "unknown";
  if (offer.powertrainKind === "combustion" || /^(petrol|gasoline|diesel|бензин|дизель)$/.test(fuel)) return "ICE";
  return "unknown";
}
export function power30FromOffer(offer:VehicleOffer):Power30Car {
  const kind = power30Kind(offer);
  const result:Power30Car = {id:offer.id,title:[catalogOfferTitle(offer),offer.year||""].filter(Boolean).join(" · "),href:offerPath(offer),inputs:{...emptyPower30Inputs,kind},inputSources:{},notes:[]};
  if (kind !== "unknown") result.inputSources.kind = "Тип силовой установки из карточки";
  if (offer.market === "uae") {result.notes.push("Для автомобилей из ОАЭ мощность вводится вручную: данные объявления требуют проверки.");return result;}
  const byMotor=offer.power30MinKwByMotor;
  const sum=byMotor?.length && byMotor.every(v=>positive(v)) ? byMotor.reduce((a,b)=>a+b,0) : undefined;
  const explicit=positive(offer.power30MinKw);
  const consistent = !sum || !explicit || Math.abs(sum-explicit)<.1;
  if (kind !== "ICE" && consistent && classifySpecificationEvidence(offer,"certifiedPower").state === "exact" && positive(sum || explicit)) {
    result.certified={kw:(sum || explicit)!,source:offer.powerDataSource || "Подтверждённые параметры карточки"};
  }
  if (kind === "BEV" && classifySpecificationEvidence(offer,"powerHp").state === "exact") {
    const kw=positive(offer.powerKw) || (positive(offer.powerHp,2500) ? offer.powerHp!/1.35962 : undefined);
    if (kw) {result.inputs.peak=String(Math.round(kw*100)/100);result.inputSources.peak="Мощность электромобиля из карточки";}
  }
  const snapshot=offer.operational?.sourceSpecifications;
  if (snapshot?.sourceId === offer.sourceId && snapshot.sourceOfferId === offer.sourceOfferId) {
    // Read only explicitly named, listing-bound electric specifications, never system/ICE power.
    const candidates:Record<string,number[]>={peak:[],torque:[],rpm:[],voltage:[]};
    for (const group of snapshot.groups) for (const item of group.items) {
      const name=item.name.trim().toLowerCase().replace(/\s+/g," ");
      const field=/^(?:电动机总功率|суммарная мощность электродвигателей|total electric motor power|electric motor maximum power)(?:\s*[（(]?(?:kw|квт)[）)]?)?$/.test(name)?"peak"
        : /^(?:电动机总扭矩|суммарный крутящий момент электродвигателей|total electric motor torque)(?:\s*[（(]?(?:n[·.]?m|н[·.]?м)[）)]?)?$/.test(name)?"torque"
        : /^(?:максимальные обороты электродвигателя|electric motor maximum speed)(?:\s*[（(]?(?:rpm|об\/мин)[）)]?)?$/.test(name)?"rpm"
        : /^(?:номинальное напряжение тяговой батареи|traction battery nominal voltage)(?:\s*[（(]?(?:v|в)[）)]?)?$/.test(name)?"voltage":null;
      if (!field) continue;
      const parsed=item.value.trim().match(/^(\d+(?:[.,]\d+)?)\s*(?:kw|квт|n[·.]?m|н[·.]?м|rpm|об\/мин|v|в)?$/i);
      const value=parsed?Number(parsed[1].replace(",",".")):0;
      if(positive(value,field==="rpm"?100000:field==="torque"?20000:2000)) candidates[field].push(value);
    }
    for (const field of ["peak","torque","rpm","voltage"] as const) {
      const values=[...new Set(candidates[field])];
      if(values.length===1 && kind!=="ICE") {result.inputs[field]=String(values[0]);result.inputSources[field]="Технические характеристики этого объявления";}
      else if(values.length>1){result.inputs[field]="";delete result.inputSources[field];result.notes.push("В объявлении противоречивые значения: "+({peak:"мощность электромоторов",torque:"крутящий момент",rpm:"обороты",voltage:"напряжение"}[field])+". Уточните вручную.");}
    }
  }
  if(kind==="ICE") result.notes.push("У автомобиля с ДВС без тягового электромотора 30-минутная электрическая мощность не применяется.");
  else if(!result.inputs.peak) result.notes.push("Пиковая мощность именно тяговых электромоторов не найдена. Общую мощность гибрида и мощность ДВС подставлять нельзя.");
  if(kind==="unknown") result.notes.push("Уточните тип силовой установки: в карточке он указан недостаточно подробно.");
  return result;
}
