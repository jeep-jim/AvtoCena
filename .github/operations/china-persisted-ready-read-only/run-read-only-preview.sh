#!/bin/bash
set -euo pipefail
umask 077
readonly op="$1" reader="$2" secret_scratch="$3" public_build="$4"
test "$(git -C "$reader" rev-parse HEAD)" = 22867cbcfaee27b2e8917b6bf880e44827f67b60
test "$(git -C "$reader" rev-parse HEAD^{tree})" = cb53c3c2b2ae656e3cabff8c63e78705e74314ba
test "$(sha256sum "$reader/.china-withdrawn-preview.cjs" |cut -d' ' -f1)" = "$(jq -er .bundleSha256 "$public_build/removal.json")"
test "$(sha256sum "$reader/.china-native-preview.cjs" |cut -d' ' -f1)" = "$(jq -er .bundleSha256 "$public_build/positive.json")"
export AVTOCENA_RELEASE_SHA=22867cbcfaee27b2e8917b6bf880e44827f67b60
export AVTOCENA_CALCULATION_VERSION=4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90
readonly withdrawal="$secret_scratch/withdrawal.json" grant="$secret_scratch/grant.json" raw="$secret_scratch/positive.json"
AVTOCENA_CHINA_REGCLOUD_RUNTIME=1 timeout -k 5s 65s node "$reader/.china-withdrawn-preview.cjs" > "$withdrawal"
# An exact verified read-only owner process writes and consumes this digest on the same runner.
readonly proof_sha="$(sha256sum "$withdrawal"|cut -d' ' -f1)"
readonly grant_sha="$(python3 "$op/make-preview-grant.py" --withdrawal-proof "$withdrawal" --expected-withdrawal-sha256 "$proof_sha" --output "$grant")"
AVTOCENA_CHINA_REGCLOUD_RUNTIME=0 timeout -k 5s 115s node "$reader/.china-native-preview.cjs" "$grant" "$grant_sha" > "$raw"
python3 - "$raw" "$withdrawal" "$public_build" <<'PY'
import hashlib,json,pathlib,sys
p,q,d=map(pathlib.Path,sys.argv[1:]); b=p.read_bytes(); w=q.read_bytes()
assert 0<len(b)<8192 and 0<len(w)<8192
x=json.loads(b);dy=json.loads(w);hash_=hashlib.sha256(w).hexdigest()
assert x['kind']=='private-china-candidate-readback' and x['removedOfferAbsent'] and x['withdrawalProofSha256']==hash_
assert x['detailRub']==x['listRub'] and x['listRub']>0
assert x['admittedRows']==168662 and x['generationId']=='gen_1795239842026_china44871616387'
assert dy['readySha256']==x['readySha256'] and dy['stableOfferId']==x['knownRemovedId']
counts={k:x[k] for k in ('readySha256','runtimeReadySha256','generationId','admittedRows','filteredCount','source','withdrawalProofSha256',
 'removedOfferAbsent','explicitRuntimeTombstone')}
digests={k+'BundleSha256':json.loads((d/(k+'.json')).read_bytes())['bundleSha256'] for k in ('removal','positive')}
print(json.dumps(counts|digests|{'kind':'china_persisted_combined_readonly_verified','matchesUserFord':dy['matchesUserFord'],
 'priceParity':True,'explicitSourceWithdrawalVerified':True,'publicationAuthorized':False,'cursorAdvanceAuthorized':False,
 'providerRequests':0,'storageWrites':0},separators=(',',':')))
PY
