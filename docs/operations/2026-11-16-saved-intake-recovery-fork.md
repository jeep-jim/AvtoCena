# Saved intake recovery compatibility

An input directory restored from our own storage contains an immutable archive
receipt. The legacy China recovery modifies its report and observations. Doing
that in the original directory makes the later archive verification correctly
reject changed bytes against the old receipt.

Recovery now verifies the original local copy, pins its saved archive as a
dependency, restores a separate working directory, and removes only the new
local copy's receipt before applying corrections. The original directory and
stored archive remain unchanged. The report is left byte-identical until the
legacy replay code computes its journal fingerprint.

After recovery the corrected report carries `rawArchiveDependencies` and the
original handoff. The corrected dataset receives a new archive identity under
the actual run and attempt. Generation provenance and the committed intake
cursor retain both the original and corrected archives. This is deliberately
conservative and does not prove the original archive is eligible for rotation.

The workflow's restore step follows `CATALOG_INTAKE_INPUT_DIR`, including the
new recovery working directory. Its source/controller approval pins, schedules,
source limits, and publication gates are unchanged. The helper performs no
supplier requests and deletes no storage objects; source replay remains in the
existing separately authorized legacy recovery path.

This compatibility change does not enable the separate raw coordination policy
or garbage collection. Its tests cover byte preservation, a new receipt for
the corrected dataset, old-root propagation to provenance and cursor, and
refusal of a changed local copy or absent protection callback.
