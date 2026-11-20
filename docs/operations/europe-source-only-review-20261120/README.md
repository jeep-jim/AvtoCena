# Europe source-only append: inert private intent and reader/retention seam

**No production writer, route, listener, upload, mutation, or dispatch.**
This is not ready to activate. The public owner must separately authorize any
later world-data read/service change.

Exact official signed dry evidence [44773701560](https://github.com/jeep-jim/AvtoCena/actions/runs/44773701560):
1,510 native AutoScout seller rows (63 existing; 1,447 would be new), unchanged
32,151 live Mobile and 6,813 prior AutoScout compact rows, on unchanged
`gen_1794878284419_a611dfcf`. A potential result is 8,260 AutoScout and 40,411
Europe; no candidate was persisted. Signed accumulator checked compact rows,
not public full-card detail indexes. Nov20 authority ends 00:00 UTC Nov21.

- **`private-append-intent.mjs`:** local pure authorizer for versioned
  `europe-private-append-reference-intent-v1`, explicitly not a native/public
  CatalogManifest. Requires original authenticated public manifest **wire
  SHA**, exact generation/count and all 78 ordered old references, official
  runtime/calc/CBR day, exact actual admitted full-row wire SHA and real
  1,447 new typed/ordered IDs from the dry proof. Candidate full rows must
  match their native admitted full bodies, and match source/ID/source EUR
  price/seller conversion on compact rows; refuses non-seller prices, foreign
  rows, stale quote day, omitted or changed retained roots. Candidate full
  output chunk descriptors are derived from bounded body bytes, and never
  written by the gate. It returns private intent metadata only, marks
  physical retention and deployment as **unverified**, never authorizes a
  pointer. It preserves the exact same existing object keys even if legacy
  manifest spells their reference relatively.
- **`22867-reference-preservation-review.patch`:** exact installed 22867
  storage blob `f402e951d56998efb75c7ac8cd1187ddc7726532` review diff.
  Current ordinary reads already resolve absolute chunk keys, but
  `getUnavailableOffer` previously double-prefixed such keys when the
  append generation later became previous. The patch makes that fallback
  Europe-only, exact-generation/market/path syntax plus **membership of
  the previous manifest** required; legacy relative path unchanged. It
  also proposes Europe inherited-generation protection for both legacy
  GC scripts (stock failed-generation cleanup previously read no
  previous manifest; even emergency object cleanup guards old roots).
  Native REG retention planner already follows active/previous absolute
  references and confirms each named object exists in its list. Do not
  execute either retention script from this package. Legacy plan/delete
  concurrency/fences still require a separate operational review: this
  patch protects observed roots, not a hypothetical pointer update racing
  an already-running cleanup.
- **`verify-native-seller-label.mjs`:** tested the actual admitted full
  body against installed 22867 exports; all 1,510 satisfy native detail
  and compact seller contracts and frozen compact card selection; both
  label routes produce **Цена продавца** and none assert a delivered total.
  No unknown technical field or delivered price backfilled.

Tests: `node --test reference.test.mjs private-intent.test.mjs` (5/5).
Tests retain all 78 legacy full-card object references, refuse exact
authority drift, source/typed/full card tamper, one omitted retention ref,
and check installed Reg retention with the inherited root only referenced
by previous (or missing a retained object => fail closed). Actual
`actual-reader-fixture.mjs` under restored 22867 closure private local process
passed before/after; previous inherited row is missing on original source
and resolves with patch, while old relative fallback/non-Europe access
are unchanged. The closure is never the running app.

**Actual intent not emitted.** Official hosted stages deliberately retained
only hashes/counts, not downloaded public manifest wire or exact per-ID tuple
overlap list. The actual 1,447 typed/full records, derived from the precise
matching list while reading the immutable root, cannot be reconstructed
from aggregate hashes. The local private 1,510 full seller bodies remain
available; no paid recollection is needed. The missing inputs for a real private
intent are the already-guarded exact public wire and the authenticated ordered
novel subset (restricted, same worker). There is no request here for 78 HEADs,
another live read, or independently listing the bucket.

Future actual live stage also needs an independent Europe reader/release or
proof that every other market still resolves the same object keys (global
generation change would normally rebind relative references), generation-bound
detail/price/count models, exact internal source settlement and readback,
reader/rollback compatibility and a fenced retention operator. The stock global
publisher still rewrites protected paths; this local contract does not turn it
into a safe source-only issuer.
