# Parallel login reads — 12.11.2026

Rejected release [43111977320](https://github.com/jeep-jim/AvtoCena/actions/runs/43111977320) stopped at strict warm /login:1.2000s, recheck median0.8712s > unchanged0.2759s. Independent read-only rollback [43121673944](https://github.com/jeep-jim/AvtoCena/actions/runs/43121673944) confirmed a182/e36/c489 at23:41:18UTC. PR1753 closed unmerged.

Read-only source75 profile [43122057561](https://github.com/jeep-jim/AvtoCena/actions/runs/43122057561) completed initial/35s/65s measurements from Actions. Feature reads725.57/1144.22/705.68ms; showcase1503.59/1627.53/1644.28ms; market quotes plus saved rate3017.94/209.87/880.23ms. Saved rate alone199.98/209.64/200.20ms. Those are runner operation timings, not serving-page timings; React request memoization is not simulated. No writes were allowed. All phases yielded the same43item ID/price digest653058fb…bc4329;2market offers,1quote error were observed, not silently removed or repaired by this patch.

Changes:
- Start public appearance and the complete dealer preview together; await both before returning the page. Preserve admission, verification, all preview items, next/error/role parameters and exception behavior.
- Public automatic dealer pricing starts unchanged market calculations and the stored rate read together. No provider refresh, stale-success fallback, skipped quote, cache lifetime or request-budget changes. Manual and explicit editor/scheduled refresh branches keep their behavior.
- Held-I/O tests exercise actual page and pricing module, prove overlap and complete output, and cover disabled profile, errors, manual rate, absent rate, caller immutability and stock-only refresh. Existing dealer-rate-refresh tests cover the real refresh lock and saved quote on source failure.

This removes two unnecessary serial dependencies. It does not establish the entire cause of the production regression or prove accepted speed under traffic. Strict unchanged source/nonce/full-response/server/browser/35s/305s acceptance is still required. Do not retry unchanged75 or deploy whole main.
