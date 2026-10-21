import { mkdir } from "node:fs/promises";
import path from "node:path";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";
import { buildSearchIndex } from "./search.mjs";
import { validateWorkspace } from "./validate.mjs";

const validation = await validateWorkspace();
if (validation.errors.length) {
  console.error(JSON.stringify({ built: false, errors: validation.errors }, null, 2));
  process.exitCode = 1;
} else {
  const data = await loadWorkspace();
  const index = buildSearchIndex(data);
  const generatedDir = path.join(WORKSPACE_ROOT, "generated");
  await mkdir(generatedDir, { recursive: true });
  await writeJson(path.join(generatedDir, "search-index.json"), index);
  console.log(JSON.stringify({ built: true, entries: index.entries.length, collisions: index.collisions.length }, null, 2));
}
