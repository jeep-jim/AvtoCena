import { displaySpecificationGroups } from "./specification-display";
import type { VehicleOffer } from "./types";
import type { SourceSpecificationSnapshot } from "./source-specifications";
import { classifySpecificationEvidence } from "./specification-evidence-audit";
import { auctionGradeLabel, assessJapanExportRestriction, japanRestrictionDescription } from "./japan-export-restriction";
import { catalogBodyName } from "./presentation";

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
    const restriction = assessJapanExportRestriction(offer);
    if (restriction) add(auction, "Экспорт из Японии", japanRestrictionDescription(restriction));
    if (auction.length) groups.push({ name: "Аукцион и экспорт", items: auction });
  }
  const snapshot = offer.operational?.sourceSpecifications;
  if (snapshot?.sourceId === offer.sourceId && snapshot.sourceOfferId === offer.sourceOfferId) {
    // Match the existing public DTO privacy boundary while retaining model/chassis codes.
    const privateIdentifier = /\bvin\b|vehicle identification|(?:frame|chassis)\s*(?:number|no\b)|номер\s*(?:кузова|рамы|шасси)|车架号/i;
    groups.push(...snapshot.groups.map(group => ({ ...group, items: group.items.filter(item => !privateIdentifier.test(item.name)) })).filter(group => group.items.length));
  }
  return displaySpecificationGroups(groups);
}
