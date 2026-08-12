from pathlib import Path

def replace(path, old, new):
    p=Path(path); s=p.read_text()
    if old not in s: raise SystemExit(f'anchor missing: {path}: {old[:80]!r}')
    p.write_text(s.replace(old,new,1))

# 1) Registry: Georgia is exactly the two company anchors, no secondaries.
p=Path('apps/web/lib/catalog/catalog-v2-source-registry.ts'); s=p.read_text()
old='''  georgia: [\n    ...REQUIRED_CATALOG_SOURCES.georgia,\n    { sourceId: "auto_georgia_open", label: "AUTO.GE", canonicalUrl: "https://www.auto.ge/", role: "secondary" },\n    { sourceId: "mymarket_georgia_open", label: "MyMarket", canonicalUrl: "https://www.mymarket.ge/", role: "secondary" },\n    { sourceId: "ss_georgia_open", label: "SS.GE", canonicalUrl: "https://ss.ge/", role: "secondary" },\n  ],'''
new='''  georgia: [\n    ...REQUIRED_CATALOG_SOURCES.georgia,\n  ],'''
if old not in s: raise SystemExit('Georgia registry block missing')
s=s.replace(old,new,1)
old2='''  const failures = Object.entries(CATALOG_V2_SOURCE_SLOTS)\n    .filter(([market, sources]) => new Set(sources.filter((source) => sourceIsCollectible(market as CatalogMarket, source)).map((source) => source.sourceId)).size < CATALOG_V2_MIN_SOURCE_SLOTS)\n    .map(([market]) => market);'''
new2='''  const failures = Object.entries(CATALOG_V2_SOURCE_SLOTS)\n    .filter(([market, sources]) => {\n      const minimum = market === "georgia" ? REQUIRED_CATALOG_SOURCES.georgia.length : CATALOG_V2_MIN_SOURCE_SLOTS;\n      return new Set(sources.filter((source) => sourceIsCollectible(market as CatalogMarket, source)).map((source) => source.sourceId)).size < minimum;\n    })\n    .map(([market]) => market);'''
if old2 not in s: raise SystemExit('registry min block missing')
p.write_text(s.replace(old2,new2,1))

# 2) Remove AUTO.GE from importer active source composition.
p=Path('apps/web/lib/catalog/importer.ts'); s=p.read_text()
s=s.replace('import { autoGeorgiaStrictSource } from "./auto-georgia-strict-source";\n','')
s=s.replace('  prepareSource(autoGeorgiaStrictSource),\n','')
p.write_text(s)

# 3) Scale sources: remove AUTO.GE, SS.GE, MyMarket; keep AutoPapa only.
p=Path('apps/web/lib/catalog/scale-market-sources.ts'); s=p.read_text()
start=s.index('''  // Georgia: MyAuto and AutoPapa have dedicated adapters.\n''')
auto=s.index('''  {\n    sourceId: "autopapa_georgia_open",''', start)
# Find end of AutoPapa object and preserve it.
end=s.index('''\n\n  // Kyrgyzstan:''', auto)
autopapa=s[auto:end]
s=s[:start]+'''  // Georgia is intentionally restricted to the two company anchor sites.\n  // MyAuto has its dedicated adapter; AutoPapa remains this exact source adapter.\n'''+autopapa+s[end:]
p.write_text(s)

# 4) Canonical quality: no Georgia source except MyAuto / AutoPapa can survive retention or public persistence.
p=Path('apps/web/lib/catalog/offer-quality.ts'); s=p.read_text()
anchor='''const REQUIRED_SOURCE_IDS = new Set(Object.values(REQUIRED_CATALOG_SOURCES).flat().map((source) => source.sourceId));\n'''
insert=anchor+'''const GEORGIA_ALLOWED_SOURCE_IDS = new Set(["myauto_georgia_list", "myauto_georgia_exact", "autopapa_georgia_open"]);\nexport function isCatalogMarketSourceAllowed(offer: Pick<VehicleOffer, "market" | "sourceId">) {\n  if (String(offer.market || "") !== "georgia") return true;\n  return GEORGIA_ALLOWED_SOURCE_IDS.has(String(offer.sourceId || ""));\n}\n'''
if anchor not in s: raise SystemExit('offer quality source anchor missing')
s=s.replace(anchor,insert,1)
needle='''  const title = listingTitle(offer);\n  if (isEncarNonCashContractOffer(offer)) return false;'''
repl='''  const title = listingTitle(offer);\n  if (!isCatalogMarketSourceAllowed(offer)) return false;\n  if (isEncarNonCashContractOffer(offer)) return false;'''
if needle not in s: raise SystemExit('credible core anchor missing')
p.write_text(s.replace(needle,repl,1))

# 5) Generic recovery cannot be pointed at AUTO.GE anymore.
p=Path('scripts/catalog-live-recovery-market.mjs'); s=p.read_text()
s=s.replace('  auto_georgia_open: ["auto.ge"],\n','')
p.write_text(s)

# 6) Direct-exact recovery is UAE-only; Georgia must go through company anchors.
p=Path('scripts/catalog-live-recovery-direct-exact.mjs'); s=p.read_text()
s=s.replace('const { autoGeorgiaStrictSource } = await import("../apps/web/lib/catalog/auto-georgia-strict-source.ts");\n','')
s=s.replace('const source = market === "uae" ? dubicarsUaeCurrentSource : market === "georgia" ? autoGeorgiaStrictSource : null;','const source = market === "uae" ? dubicarsUaeCurrentSource : null;')
s=s.replace('const EXPECTED_HOST = market === "uae" ? "dubicars.com" : "auto.ge";','const EXPECTED_HOST = "dubicars.com";')
p.write_text(s)

# 7) Workflow: canonical-only Georgia, no fallback under any condition.
p=Path('.github/workflows/catalog-live-recovery-uae-georgia-direct.yml'); s=p.read_text()
start=s.index('''      - name: Collect canonical company sources first; fallback only when both Georgia anchors are unavailable\n''')
end=s.index('''      - uses: actions/upload-artifact@v4\n''', start)
block='''      - name: Collect Georgia only from MyAuto and AutoPapa\n        shell: bash\n        run: |\n          set -euo pipefail\n          if [ "$RECOVERY_DIRECT_MARKET" != "georgia" ]; then\n            npx tsx scripts/catalog-live-recovery-direct-exact.mjs\n            exit 0\n          fi\n\n          FINAL_OUTPUT="catalog-rebuild-georgia.json"\n          SELECTION_REPORT="catalog-georgia-source-selection.json"\n          set +e\n          RECOVERY_MARKET=georgia \\\n          RECOVERY_SOURCE_IDS="myauto_georgia_list,autopapa_georgia_open" \\\n          RECOVERY_OUTPUT="$FINAL_OUTPUT" \\\n          npx tsx scripts/catalog-live-recovery-market.mjs\n          canonical_status=$?\n          set -e\n          node - "$FINAL_OUTPUT" "$SELECTION_REPORT" "$canonical_status" <<'NODE'\n          const fs = require('fs');\n          const [input, output, status] = process.argv.slice(2);\n          let payload = {};\n          try { payload = JSON.parse(fs.readFileSync(input, 'utf8')); } catch {}\n          const count = Number(payload.count || 0);\n          const report = {\n            canonicalSourceIds: ['myauto_georgia_list', 'autopapa_georgia_open'],\n            canonicalExitStatus: Number(status),\n            canonicalCount: count,\n            canonicalDiagnostics: payload.report?.sources || [],\n            usedFallback: false,\n            fallbackForbidden: true,\n          };\n          fs.writeFileSync(output, JSON.stringify(report, null, 2));\n          console.log(report);\n          if (Number(status) !== 0 || count <= 0) process.exit(2);\n          NODE\n'''
s=s[:start]+block+s[end:]
s=s.replace('          node --import tsx --test tests/auto-georgia-price.test.ts\n','')
p.write_text(s)

# 8) Regression test for permanent Georgia source contract.
Path('tests/georgia-canonical-source-policy-20260812.test.ts').write_text('''import assert from "node:assert/strict";\nimport test from "node:test";\nimport { catalogV2SourceIds, assertCatalogV2SourceRegistry } from "../apps/web/lib/catalog/catalog-v2-source-registry";\nimport { isCatalogMarketSourceAllowed } from "../apps/web/lib/catalog/offer-quality";\n\ntest("Georgia registry contains only MyAuto and AutoPapa", () => {\n  assert.deepEqual(catalogV2SourceIds("georgia"), ["myauto_georgia_list", "autopapa_georgia_open"]);\n  assert.equal(assertCatalogV2SourceRegistry(), true);\n});\n\ntest("Georgia canonical quality permanently rejects non-company sources", () => {\n  assert.equal(isCatalogMarketSourceAllowed({market:"georgia", sourceId:"myauto_georgia_list"} as any), true);\n  assert.equal(isCatalogMarketSourceAllowed({market:"georgia", sourceId:"myauto_georgia_exact"} as any), true);\n  assert.equal(isCatalogMarketSourceAllowed({market:"georgia", sourceId:"autopapa_georgia_open"} as any), true);\n  for (const sourceId of ["auto_georgia_open","mymarket_georgia_open","ss_georgia_open"]) {\n    assert.equal(isCatalogMarketSourceAllowed({market:"georgia", sourceId} as any), false);\n  }\n});\n''')
