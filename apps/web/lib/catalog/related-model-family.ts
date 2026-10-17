import { canonicalCatalogBrand } from './brands';
import { matchesCatalogModel } from './model-filter';
import { readVehicleKnowledgeModels, type VehicleKnowledgeModel } from './vehicle-knowledge';

/** Discovery only: never replace the offer's technical model identity. */
export function relatedModelFamily(make: string, model: string, directory: readonly VehicleKnowledgeModel[]): string {
  const brand = canonicalCatalogBrand(make);
  const scoped = directory.filter(row => row.active !== false
    && [row.make, ...(row.makeAliases || [])].some(value => canonicalCatalogBrand(value) === brand));
  const names = [model];
  for (const row of scoped) {
    if ([row.model, ...(row.aliases || [])].some(value => matchesCatalogModel(model, value))) names.push(row.model);
  }
  const bases = scoped.filter(row => names.some(value => matchesCatalogModel(value, row.model)));
  // Only known complete model names qualify; do not blindly remove letters or digits.
  const size = (value: string) => value.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '').length;
  bases.sort((a, b) => size(a.model) - size(b.model) || a.model.localeCompare(b.model));
  return bases[0]?.model || model.trim();
}

export async function readRelatedModelFamily(make: string, model: string): Promise<string> {
  try { return relatedModelFamily(make, model, await readVehicleKnowledgeModels()); }
  catch (error) { console.error('related_model_family_failed', error); return model.trim(); }
}
