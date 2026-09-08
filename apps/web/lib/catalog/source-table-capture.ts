import type { VehicleOffer } from "./types";
import type { SourceSpecificationSnapshot } from "./source-specifications";
type Groups = SourceSpecificationSnapshot["groups"];
const privateField = /(?:^chassis$|seller|dealer|contact|phone|email|address|password|token|vin\b|frame.?number|license.?plate|registration.?number|телефон|продавец|адрес|车架号)/i;
const scalar = (value: unknown): string | null => value === null ? "—" : ["string","number","boolean"].includes(typeof value) ? String(value) : null;
/** Call only for a known technical container from an identity-checked detail. */
export function namedTechnicalGroups(input: unknown, groupName = "Характеристики источника"): Groups {
  const items: Array<{name:string;value:string}> = [], nested: Groups = [];
  if (Array.isArray(input)) {
    for (const row of input) {
      if (typeof row === "string") { if (!privateField.test(row)) items.push({name:row,value:"Есть"}); continue; }
      if (!row || typeof row !== "object") continue;
      const name = row.name ?? row.label ?? row.title ?? row.key;
      if (typeof name !== "string" || privateField.test(name)) continue;
      const children = row.paramitems ?? row.items ?? row.attributes ?? row.values ?? row.features;
      if (Array.isArray(children)) { nested.push(...namedTechnicalGroups(children,name)); continue; }
      const valueKey = ["value","displayValue","formattedValue","description","text","isPresent"].find(key=>Object.hasOwn(row,key));
      const value = scalar(valueKey ? row[valueKey] : undefined);
      if (value !== null) items.push({name,value});
    }
  } else if (input && typeof input === "object") {
    for (const [name,value] of Object.entries(input)) {
      if (privateField.test(name)) continue;
      const text = scalar(value);
      if (text !== null) items.push({name,value:text});
      else nested.push(...namedTechnicalGroups(value,name));
    }
  }
  return [...(items.length ? [{name:groupName,items}] : []),...nested];
}
export function captureSourceTable(offer: VehicleOffer, groups: Groups, kind: "specification_table" | "listing_fields" = "specification_table") {
  if (!offer.sourceId || !offer.sourceOfferId || !offer.operational?.sourceUrl) return;
  const filtered = groups.map(group=>({...group,items:group.items.filter(item=>!privateField.test(item.name))})).filter(group=>group.items.length);
  const fieldCount = filtered.reduce((sum,group)=>sum+group.items.length,0);
  offer.operational = {...offer.operational,
    sourceSpecifications: fieldCount ? {version:1,sourceId:offer.sourceId,sourceOfferId:offer.sourceOfferId,specificationId:offer.sourceOfferId,
      sourceUrl:offer.operational.sourceUrl,capturedAt:new Date().toISOString(),groups:filtered} : offer.operational.sourceSpecifications,
    specificationCollection:{status:fieldCount ? "received" : "table_not_in_detail",kind,groupCount:filtered.length,fieldCount},
  } as VehicleOffer["operational"];
}
