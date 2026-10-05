/** Restore an explicit source name lost by base-model display normalization. */
export function restoreSourceModelName<T extends Record<string, any>>(offer:T):T {
 if (offer.market !== "china" || !/^toyota$/i.test(String(offer.make)) || !/^yaris(?:\s*l\b.*)?$/i.test(String(offer.model))) return offer;
 const names=[offer.model,offer.calculationSnapshot?.customsInput?.model,offer.encyclopediaDisplayIdentity?.rawModel,offer.operational?.raw?.model,offer.operational?.raw?.Model];
 if (!names.some(name=>/^yaris\s*l(?:\b|\s)/i.test(String(name || "")))) return offer;
 return {...offer,model:"Yaris L"};
}
