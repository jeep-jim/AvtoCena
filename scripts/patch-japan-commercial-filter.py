from pathlib import Path

path = Path('scripts/catalog-live-recovery-japan-prestige.mjs')
text = path.read_text()

import_anchor = 'import fs from "node:fs/promises";\n'
import_line = 'import { isJapanCommercialAuctionOffer } from "../apps/web/lib/catalog/japan-commercial.ts";\n'
if import_line not in text:
    if import_anchor not in text:
        raise SystemExit('missing import anchor')
    text = text.replace(import_anchor, import_anchor + import_line, 1)

old_re = 'const COMMERCIAL_RE = /\\b(?:truck|dump|tipper|bus|minibus|commercial|cargo|lorry|tractor|forklift|excavator|machinery|canter|fighter|dutro|forward|giga|elf|profia)\\b/i;\n'
if old_re in text:
    text = text.replace(old_re, '', 1)

old_check = '  if (COMMERCIAL_RE.test(`${offer.make || ""} ${offer.model || ""} ${offer.trim || ""}`)) { reject("commercial"); return null; }'
new_check = '  if (isJapanCommercialAuctionOffer(offer)) { reject("commercial"); return null; }'
if new_check not in text:
    if old_check not in text:
        raise SystemExit('missing commercial check anchor')
    text = text.replace(old_check, new_check, 1)

path.write_text(text)
print('japan_commercial_filter_patch_ok')
