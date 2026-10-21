import fs from "node:fs/promises";

const file = "apps/web/lib/catalog/presentation.ts";
let text = await fs.readFile(file, "utf8");

const marker = `function publicTitleTrim(value: unknown) {`;
const helper = `function publicResolvedModelLabel(offer: any, fallback: string) {\n  const identity = offer?.operational?.encyclopediaIdentity || {};\n  const rawModel = compactListingText(identity.rawModel);\n  const source = String(identity.modelSource || \"\").replace(/^presentation:/, \"\");\n  // The V2 resolver only emits safe_alias/search_index after uniqueness checks.\n  // Preserve that proven source model label for humans/SEO (RX300, NX350h, etc.)\n  // while the stored canonical family remains RX/NX for grouping and dedupe.\n  if ((source === \"safe_alias\" || source === \"search_index\")\n    && /^[A-Za-z0-9][A-Za-z0-9+._ /-]{0,47}$/.test(rawModel)\n    && rawModel.length > fallback.length\n    && normalizedIdentity(rawModel).startsWith(normalizedIdentity(fallback))) {\n    return collapseAdjacentRepeatedPhrases(rawModel);\n  }\n  return fallback;\n}\n\n`;
if (!text.includes("function publicResolvedModelLabel")) {
  const at = text.indexOf(marker);
  if (at < 0) throw new Error("safe_model_label_marker_missing");
  text = text.slice(0, at) + helper + text.slice(at);
}

const titleModel = `  const model = china ? publicChinaModel(offer) : publicMarketIdentity(offer?.model, market);`;
const titleModelNext = `  const canonicalModel = china ? publicChinaModel(offer) : publicMarketIdentity(offer?.model, market);\n  const model = china ? canonicalModel : publicResolvedModelLabel(offer, canonicalModel);`;
if (text.includes(titleModel)) text = text.replace(titleModel, titleModelNext);
else if (!text.includes("publicResolvedModelLabel(offer, canonicalModel)")) throw new Error("safe_model_title_marker_missing");

const presentModel = `    modelLabel: isChinaOffer(offer) ? collapseAdjacentRepeatedPhrases(publicChinaModel(offer)) : collapseAdjacentRepeatedPhrases(publicMarketIdentity(offer?.model, market)),`;
const presentModelNext = `    modelLabel: isChinaOffer(offer)\n      ? collapseAdjacentRepeatedPhrases(publicChinaModel(offer))\n      : publicResolvedModelLabel(offer, collapseAdjacentRepeatedPhrases(publicMarketIdentity(offer?.model, market))),`;
if (text.includes(presentModel)) text = text.replace(presentModel, presentModelNext);
else if (!text.includes("publicResolvedModelLabel(offer, collapseAdjacentRepeatedPhrases")) throw new Error("safe_model_presentation_marker_missing");

await fs.writeFile(file, text);
console.log("safe public model label repair applied");
