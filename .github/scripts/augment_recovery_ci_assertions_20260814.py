from pathlib import Path

hardening = Path("tests/catalog-production-hardening.test.ts")
s = hardening.read_text()
old = 'const recoveryPublisher = fs.readFileSync(new URL("../scripts/catalog-live-recovery-publish-batch.mjs", import.meta.url), "utf8");'
new = old + '\nconst singleRecoveryPublisher = fs.readFileSync(new URL("../scripts/catalog-live-recovery-publish.mjs", import.meta.url), "utf8");'
if old not in s:
    raise SystemExit("recoveryPublisher import target not found")
s = s.replace(old, new, 1)
anchor = '''test("recovery publisher always preserves untouched full maintenance state exactly", () => {
  assert.match(recoveryPublisher, /readAllOffersForMaintenance/);
  assert.match(recoveryPublisher, /const preserveUntouchedExact = true/);
  assert.match(recoveryPublisher, /preservedInternalByMarket/);
  assert.match(recoveryPublisher, /preservedPublicHashByMarket/);
  assert.match(recoveryPublisher, /recovery_batch_preserved_internal_gate_failed/);
  assert.match(recoveryPublisher, /recovery_batch_preserved_manifest_mismatch/);
  assert.match(recoveryPublisher, /recovery_batch_preserved_hash_mismatch/);
});'''
addition = anchor + '''

test("single recovery publisher preserves full maintenance state and enforces target gallery depth", () => {
  assert.match(singleRecoveryPublisher, /readAllOffersForMaintenance/);
  assert.match(singleRecoveryPublisher, /CATALOG_REBUILD_MIN_IMAGES_PER_OFFER\\s*\\|\\|\\s*5/);
  assert.match(singleRecoveryPublisher, /recovery_target_image_gate_failed/);
  assert.match(singleRecoveryPublisher, /preservedInternalByMarket/);
  assert.match(singleRecoveryPublisher, /preservedPublicHashByMarket/);
  assert.match(singleRecoveryPublisher, /postPersistPublicHashByMarket/);
  assert.match(singleRecoveryPublisher, /preservationFailures/);
  assert.match(singleRecoveryPublisher, /recovery_preserved_internal_gate_failed/);
  assert.match(singleRecoveryPublisher, /recovery_duplicate_id_in_full_state/);
});'''
if anchor not in s:
    raise SystemExit("mandatory batch recovery test target not found")
hardening.write_text(s.replace(anchor, addition, 1))
