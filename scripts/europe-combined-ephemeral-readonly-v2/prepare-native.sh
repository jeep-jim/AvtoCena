#!/usr/bin/env bash
set -euo pipefail
umask 077
# exact official/native Git checkout, dependency closure from its pinned lock,
# exact already-saved archive ZIP, exact official XML, fresh ephemeral run root
repo=$(realpath "$1")
deps=$(realpath "$2")
zip=$(realpath "$3")
xml=$(realpath "$4")
out=$(realpath -m "$5")
bundle=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
pin=22867cbcfaee27b2e8917b6bf880e44827f67b60
[[ "$(date -u +%F)" == 2026-11-20 ]]
[[ -d "$deps/tsx" && -x "$deps/.bin/tsx" ]]
[[ "$(sha256sum "$zip" | awk '{print $1}')" == d822258671996030c53e934adfd3b48136243241f4f442b62172728b50319316 ]]
[[ "$(sha256sum "$xml" | awk '{print $1}')" == 2adeb25ad182398684c4c646e110ded5449f7174e4a4442f8bff6b7d1d32aec6 ]]
mkdir -m 700 -- "$out"
# No runtime snapshot or unrelated files: derive the exact explicit closure only.
if git -C "$repo" cat-file -e "$pin^{commit}" 2>/dev/null; then
  cut -f2 "$bundle/exact-tree.tsv" | (
    mapfile -t paths
    git -C "$repo" archive "$pin" -- "${paths[@]}"
  ) | tar -xf - -C "$out"
else
  # Recovered blob-only snapshot is allowed only when every byte of the
  # same explicit closure matches the official Git blob SHA below.
  while IFS=$'\t' read -r sha f; do
    install -D -m600 "$repo/$f" "$out/$f"
  done < "$bundle/exact-tree.tsv"
fi
cd "$out"
python - "$bundle/exact-tree.tsv" <<'PY'
from pathlib import Path
import hashlib,sys
lines=Path(sys.argv[1]).read_text().splitlines()
assert len(lines)==738
for line in lines:
 sha,f=line.split('\t');data=Path(f).read_bytes()
 assert hashlib.sha1(('blob '+str(len(data))+'\0').encode()+data).hexdigest()==sha
PY
ln -s -- "$deps" node_modules
install -m600 "$xml" official-cbr.xml
install -m600 "$bundle/strict-offline.mjs" strict-offline.mjs
mkdir -m700 evidence catalog-intake-input
mkdir -m700 catalog-intake-input/catalog-intake-europe
python "$bundle/archive-membership.py" "$zip" archived-observations.json > evidence/archive-verified.log
python - "$zip" <<'PY'
from pathlib import Path
from zipfile import ZipFile
import re,sys,shutil
with ZipFile(sys.argv[1]) as z:
 entries=z.infolist()
 assert len(entries)==31 and len(set(i.filename for i in entries))==31
 for src in entries:
  assert re.fullmatch(r'(?:raw-)?autoscout_europe_open-\d{6}\.jsonl|report\.json|own-storage-receipt\.json',src.filename) and src.file_size<9000000
  target=Path('catalog-intake-input/catalog-intake-europe')/src.filename
  with z.open(src) as i, target.open('xb') as o: shutil.copyfileobj(i,o)
PY
chmod 500 data
python "$bundle/instrument.py" "$(awk -F '\t' '$2=="scripts/catalog-publish-market.mjs"{print $1}' "$bundle/exact-tree.tsv")"
env -i PATH="$PATH" HOME="$PWD" TZ=UTC NODE_ENV=test JSON_STORAGE_DRIVER=local timeout 120 node --import tsx --import ./strict-offline.mjs scripts/catalog-intake-to-publication.mjs >evidence/conversion.log 2>&1
env -i PATH="$PATH" HOME="$PWD" TZ=UTC NODE_ENV=test JSON_STORAGE_DRIVER=local CATALOG_SELLER_INVENTORY=1 CATALOG_PUBLICATION_DRY_RUN=1 CATALOG_REBUILD_MARKETS=europe CATALOG_REBUILD_INPUT_DIR=catalog-intake-publish timeout 150 node --max-old-space-size=2048 --import tsx --import ./strict-offline.mjs scripts/catalog-publish-local-europe-evidence.mjs >evidence/replay.log 2>&1
node "$bundle/verify-native.mjs" "$out/evidence"
