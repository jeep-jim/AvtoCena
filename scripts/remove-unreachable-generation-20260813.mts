const { getJsonStorage, readDataJson } = await import("../apps/web/lib/data.ts");
const target = String(process.env.CATALOG_UNREACHABLE_GENERATION_TARGET || "").trim();
if (!/^gen_\d+_[-a-z0-9]+$/i.test(target)) throw new Error("unreachable_generation_target_invalid");
const storage: any = getJsonStorage();
if (!storage.listObjects || !storage.deleteObjects) throw new Error(`unreachable_generation_cleanup_not_supported_${storage.driver}`);

async function liveGeneration() {
  const manifest: any = await readDataJson("catalog/manifest.json", { generationId: "" });
  return String(manifest?.generationId || "");
}

const liveBefore = await liveGeneration();
if (!liveBefore) throw new Error("unreachable_generation_live_missing");
if (liveBefore === target) throw new Error("unreachable_generation_target_is_live");

const prefix = `catalog/generations/${target}`;
const objects: any[] = await storage.listObjects(prefix);
if (!objects.length) throw new Error("unreachable_generation_target_empty");
const bytes = objects.reduce((sum, item) => sum + Math.max(0, Number(item?.size || 0)), 0);
if (objects.some((item) => !String(item?.key || "").startsWith(`${prefix}/`))) throw new Error("unreachable_generation_prefix_escape");

// Re-read the live pointer immediately before deletion. A publication cannot
// make this exact failed generation live without changing catalog/manifest.json.
const liveImmediatelyBeforeDelete = await liveGeneration();
if (liveImmediatelyBeforeDelete !== liveBefore) throw new Error(`unreachable_generation_manifest_changed_${liveBefore}_${liveImmediatelyBeforeDelete}`);
if (liveImmediatelyBeforeDelete === target) throw new Error("unreachable_generation_target_became_live");

let deleted = 0;
for (let i = 0; i < objects.length; i += 1000) {
  const batch = objects.slice(i, i + 1000).map((item) => String(item.key));
  deleted += Number(await storage.deleteObjects(batch));
}
const remaining: any[] = await storage.listObjects(prefix);
const liveAfter = await liveGeneration();
if (liveAfter !== liveBefore) throw new Error(`unreachable_generation_live_changed_after_delete_${liveBefore}_${liveAfter}`);
if (remaining.length) throw new Error(`unreachable_generation_delete_incomplete_${remaining.length}`);
console.log(JSON.stringify({
  finishedAt: new Date().toISOString(),
  target,
  liveGeneration: liveAfter,
  deletedObjects: deleted,
  reclaimedBytes: bytes,
  reclaimedMiB: Math.round(bytes / 1048576 * 10) / 10,
  remainingObjects: remaining.length,
}, null, 2));
