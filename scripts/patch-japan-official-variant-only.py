from pathlib import Path

path = Path('scripts/catalog-live-recovery-japan-prestige.mjs')
text = path.read_text()
needle = '    if (variant.active === false || variant.modelId !== match.model.id) return false;\n'
replacement = needle + '    if (!["manufacturer", "official_registry"].includes(String(variant.sourceType || "").trim().toLowerCase())) return false;\n'
if replacement not in text:
    if text.count(needle) != 1:
        raise SystemExit(f'variant filter anchor count={text.count(needle)}')
    text = text.replace(needle, replacement, 1)
path.write_text(text)
print('japan_official_variant_only_patch_ok')
