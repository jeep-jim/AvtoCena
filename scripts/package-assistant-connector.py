"""Build the downloadable extension deterministically, without credentials or dependencies."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
root = Path(__file__).resolve().parents[1] / 'apps/web/public'
with ZipFile(root / 'assistant-connector.zip', 'w') as archive:
    for name in ('manifest.json', 'background.js', 'site.js', 'chatgpt.js'):
        info = ZipInfo(name, (2026, 10, 13, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, (root / 'assistant-connector' / name).read_bytes())
