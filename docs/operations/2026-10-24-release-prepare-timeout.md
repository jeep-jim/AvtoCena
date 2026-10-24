# Release preparation timeout — 24 October 2026

Deployment 40103448997, release 7189a40f73606b46eaeb86e4c37905e1fd0bfcf6, reached its 60-minute prepare-job limit during candidate activation. Its log ends at 15:40:05 UTC with "The operation was canceled". The public encyclopedia check was skipped. Public health after cancellation still returned 8ec0d8587d9891757f8cdf019f2c9c55adcaef31; activation is not accepted.

The job spent approximately 27 minutes waiting for repair 40104679690. After that lock was released, selectors, specifications, budget caches, all five retained-market nonempty checks and all four specification parity checks passed. Candidate activation began at 15:39:35, leaving only about 30 seconds.

Increase only the prepare job limit to 90 minutes. The independent ASTRA wait job remains at 60 minutes; the publication-lock wait remains bounded at 40 minutes. Keep all activation, rollback, source-boundary and public verification checks. This workflow-only change does not request a new deployment.

PR1524 has separately merged as 9545271b074252da2c916470f3efbded518c233c, starting repair 40108157776. Finish that repair before requesting the next coordinated release. Do not launch collectors, duplicate the ASTRA apply, or treat the failed release as installed. Preserve pending Cupra and all existing required batch/plan digests in the next authorized release.
