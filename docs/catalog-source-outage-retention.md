# Source outage retention

Normal retention stays unchanged: 3 days for daily markets and 30 days for Japan.

A parser/network failure is not proof that a listing disappeared. The market publisher now consumes per-source collection diagnostics. A source may expire rows beyond normal retention only after a completed live source cycle with fresh saved offers. Failed, partial, retention-only, or zero-fresh runs are non-authoritative.

For non-authoritative sources, previously active/stale rows receive a bounded grace window of 2x normal retention by default (`CATALOG_SOURCE_OUTAGE_RETENTION_MULTIPLIER`). This means up to 6 days on daily markets and up to 60 days for Japan. The multiplier is capped at 4 so outages cannot create immortal inventory.

The publish report records source refresh states, rows protected by outage grace, rows expired after an authoritative refresh, and rows that exceeded outage grace.
