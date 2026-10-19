import { displaySpecificationGroups } from "./specification-display";
import type { VehicleOffer } from "./types";
import type { SourceSpecificationSnapshot } from "./source-specifications";
import { classifySpecificationEvidence } from "./specification-evidence-audit";
import { auctionGradeLabel, assessJapanExportRestriction, japanRestrictionDescription } from "./japan-export-restriction";
import { catalogBodyName, catalogDriveName, catalogTransmissionName } from "./presentation";
import { catalogPowerSanity } from "./power-sanity";

export function offerSpecificationGroups(offer: VehicleOffer, display?: { bodyLabel?: string }): SourceSpecificationSnapshot["groups"] {
  const groups: SourceSpecificationSnapshot["groups"] = [];
  const basic: Array<{name: string; value: string}> = [];
  const add = (items: typeof basic, name: string, value: unknown) => {
    if ((typeof value === "string" && value.trim()) || (typeof value === "number" && Number.isFinite(value))) items.push({ name, value: String(value) });
  };
  add(basic, "Марка", offer.make); add(basic, "Модель", offer.model); add(basic, "Комплектация", offer.trim);
  if (offer.year > 1900) add(basic, "Год в объявлении", offer.year);
  if (typeof offer.mileageKm === "number" && offer.mileageKm >= 0) add(basic, "Пробег, км", offer.mileageKm);
  const bodyLabel = display?.bodyLabel ?? catalogBodyName(offer.bodyType, offer);
  if (bodyLabel && bodyLabel !== "уточняется") add(basic, "Кузов", bodyLabel);
  if(offer.editorialSpecifications?.drive)add(basic,"Привод",catalogDriveName(offer.drive));
  if(offer.editorialSpecifications?.transmission)add(basic,"Коробка передач",catalogTransmissionName(offer.transmission));
  if(offer.color)add(basic,"Цвет",offer.color);
  if(/^ajes_(?:korea|china)_feed$/.test(offer.sourceId)){add(basic,'VIN / номер кузова',offer.frameNumber);add(basic,'Номер объявления',offer.lotNumber);if(typeof offer.operational?.sourceDate==='string'&&/^\d{4}\.(?:0?[1-9]|1[0-2])$/.test(offer.operational.sourceDate))add(basic,'Дата в объявлении',offer.operational.sourceDate);if(offer.drive)add(basic,'Привод',catalogDriveName(offer.drive));if(offer.transmission)add(basic,'Коробка передач',catalogTransmissionName(offer.transmission));add(basic,'Оснащение',offer.operational?.sourceEquipment);}
  if (basic.length) groups.push({ name: "Об автомобиле", items: basic });
  const verified: typeof basic = [];
  if (classifySpecificationEvidence(offer, "engineCc").state === "exact") add(verified, "Рабочий объём, см³", offer.engineCc);
  if (classifySpecificationEvidence(offer, "fuelPowertrain").state === "exact") {
    const fuels: Record<string, string> = { petrol: "Бензин", gasoline: "Бензин", diesel: "Дизель", electric: "Электро", hybrid: "Гибрид", phev: "Подключаемый гибрид" };
    add(verified, "Топливо", fuels[offer.fuel || ""] || offer.fuel);
    const kinds: Record<string, string> = { combustion: "ДВС", electric: "Электромобиль", series_hybrid: "Последовательный гибрид", other_hybrid: "Гибрид" };
    add(verified, "Силовая установка", kinds[offer.powertrainKind || ""]);
  }
  if (classifySpecificationEvidence(offer, "powerHp").state === "exact") { add(verified, "Мощность, л.с.", offer.powerHp); add(verified, "Мощность, кВт", offer.powerKw); }
  if (classifySpecificationEvidence(offer, "certifiedPower").state === "exact") add(verified, "30-минутная мощность, кВт", offer.power30MinKw);
  if (verified.length) groups.push({ name: "Подтверждённые параметры", items: verified });
  if (offer.market === "japan") {
    const auction: typeof basic = [];
    add(auction, "Оценка аукциона", auctionGradeLabel(offer.auctionGrade));
    add(auction, "Аукцион", offer.auctionName); add(auction, "Дата аукциона", offer.auctionDate); add(auction, "Лот", offer.lotNumber);
    add(auction, "Код кузова", offer.operational?.modelCode || offer.operational?.chassisCode);
    if(offer.sourceId==='ajes_japan_feed'){
      add(auction,"Номер кузова",offer.frameNumber);
      add(auction,"Место проведения",offer.operational?.auctionTown);
      const source=offer.operational?.raw as Record<string,unknown>|undefined;
      add(auction,"Мощность: варианты поставщика",source?.sourcePower);
      add(auction,"Привод: обозначение поставщика",source?.sourceDrive);
      add(auction,"КПП: обозначение поставщика",source?.sourceTransmission);
      add(auction,"Тип КПП: обозначение поставщика",offer.operational?.sourceTransmissionCode);
      add(auction,"Оснащение",offer.operational?.sourceEquipment);
    }
    const restriction = assessJapanExportRestriction(offer);
    if (restriction) add(auction, "Экспорт из Японии", japanRestrictionDescription(restriction));
    if (auction.length) groups.push({ name: "Аукцион и экспорт", items: auction });
  }
  const snapshot = offer.operational?.sourceSpecifications;
  if (snapshot?.sourceId === offer.sourceId && snapshot.sourceOfferId === offer.sourceOfferId) {
    // Match the existing public DTO privacy boundary while retaining model/chassis codes.
    const privateIdentifier = /\bvin\b|vehicle identification|(?:frame|chassis)\s*(?:number|no\b)|номер\s*(?:кузова|рамы|шасси)|车架号/i;
    const rejectedPower = catalogPowerSanity(offer).suspicious || (offer.operational as any)?.powerSanity?.rejected;
    const powerField = /hrspow|horsepower|\b(?:power|hp|bhp|ps|kw)\b|мощност|л\.\s*с\.|кВт|출력|마력|功率|马力/i;
    groups.push(...snapshot.groups.map(group => ({ ...group, items: group.items.filter(item => !privateIdentifier.test(item.name)
      && !(rejectedPower && powerField.test(item.name))) })).filter(group => group.items.length));
  }
  const displayed=displaySpecificationGroups(groups);
  // The first group carries the corrected values; avoid contradictory source rows.
  const corrected=offer.editorialSpecifications;
  if(!corrected)return displayed;
  return displayed.map((group,index)=>index===0?group:{...group,items:group.items.filter(item=>
   !(corrected.bodyType&&/^(кузов|тип кузова)$/i.test(item.name.trim()))&&
   !(corrected.drive&&/^(привод|тип привода)$/i.test(item.name.trim()))&&
   !(corrected.transmission&&/^(коробка передач|трансмиссия|кпп)$/i.test(item.name.trim()))&&
   !(corrected.color&&/^(цвет|цвет кузова)$/i.test(item.name.trim())))}).filter(group=>group.items.length);
}
