import fs from "node:fs/promises";

const file = "apps/web/lib/catalog/knowledge-core.ts";
let text = await fs.readFile(file, "utf8");
const oldBlock = `function sourcePowerAuthoritative(offer: VehicleOffer) {\n  const source = clean((offer as any).powerDataSource).toLowerCase();\n  const confidence = clean((offer as any).powerDataConfidence).toLowerCase();\n  return /documented|source_exact|homolog|coc|registration|official/.test(\`${"${source} ${confidence}"}\`);\n}`;
const newBlock = `function sourcePowerAuthoritative(offer: VehicleOffer) {\n  const source = clean((offer as any).powerDataSource).toLowerCase();\n  const confidence = clean((offer as any).powerDataConfidence).toLowerCase();\n  // source_exact means only that the marketplace field was extracted exactly.\n  // It does NOT prove the seller/source value is physically or factually true.\n  // Only official/regulatory provenance is strong enough to block a conflicting\n  // uniquely matched Encyclopedia V2 variant.\n  return /homolog|type.?approval|coc|certificate|registration|government|manufacturer.?official|official.?spec|regulatory/.test(\`${"${source} ${confidence}"}\`);\n}`;
if (text.includes(oldBlock)) text = text.replace(oldBlock, newBlock);
else if (!text.includes("source_exact means only that the marketplace field was extracted exactly")) {
  throw new Error("knowledge_power_authority_marker_missing");
}
await fs.writeFile(file, text);
console.log("knowledge power authority repair applied");
