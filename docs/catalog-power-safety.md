# Catalog horsepower safety

Horsepower is calculation-critical and must preserve provenance.

1. `documented` and `source_exact` source horsepower remain authoritative.
2. An untrusted source value may be replaced only by one uniquely matched vehicle-knowledge variant when the conflict is material.
3. A model-wide representative value may fill a missing field, but it never blindly replaces a conflicting source value.
4. If a large conflict exists and no unique variant resolves it, horsepower is cleared and the offer must proceed through normal missing-data safety rather than display a confidently wrong number.
5. Every conflict resolution is recorded in the offer operational raw metadata for audit.
