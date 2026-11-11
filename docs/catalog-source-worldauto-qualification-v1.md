# WorldAuto Georgia — source qualification checkpoint v1

Date: 2026-09-04

## Scope and safety

This checkpoint is research-only and no-write. It does **not** authorize publication into the AvtoCena catalog.

- source: `worldauto_georgia_candidate`
- registry route: `https://worldauto.ge/en/search/car`
- production writes: `false`
- catalog/Object Storage writes: `false`
- publication permission: `false`
- classification after this checkpoint: `lead_only`

## Technical evidence

Permission-first probing started from the registry-declared public search page and only followed routes/assets declared by WorldAuto itself.

Successful evidence runs:

| Run | Artifact | Digest | Result |
| --- | --- | --- | --- |
| `33854811320` | `9929768931` | `sha256:0a3eefa50fbe2390723f1cfeaafe753b4f5ddbfc9fff300e642afd19812e5451` | robots + registry page only; public page `200`, no explicit automation restriction found in that page body |
| `33855034005` | `9929937759` | `sha256:de02d3c4352d9df80e9f5789b65fc20161c08e81bb07dfed5af8e97ac06f34b6` | source-declared application assets expose `/search/sell/car/get` and related routes; no endpoint was guessed |
| `33855980435` | `9930192692` | `sha256:f9979749be5667cd4d69ada76a6bd321526d7caa1015092746ed625767aa76ed` | minified callsite proves `GET /search/sell/car/get` with source-supplied params object; no params were invented/sent |
| `33856160338` | `9930267117` | `sha256:da4892d6dd7f0229da8add0bffe6d745829921b5ac8a9cd415c13c8955c06a21` | source bundle proves the shared HTTP client used by the search call |
| `33856330429` | `9930327906` | `sha256:569a09f2df373d58ca6fbee5eb5eef51f94d9e29a2364d587cfc9bbd5bccdea1` | source config declares `https://worldauto-backend-production.up.railway.app` as the backend base URL |
| `33856502011` | `9930390296` | `sha256:2cc71a785eec01ca4484973a37fd425b7a347ddea03b2b39153f0a50d7446d74` | exactly one no-param GET to the source-declared search endpoint returned `200 application/json`; response exceeded the bounded capture size and was not stored raw |
| `33856667630` | `9930452094` | `sha256:47501b56a536d7e00c7354a906c9ba0d4c3828d8954bfc2a272bbe9e0e3b8c75` | first balanced listing object recovered from the bounded JSON prefix; no pagination/detail requests |

The recovered offer-bound sample proves a technically strong field set:

- source id: `4059e21f-dda8-4751-af8a-b97b5c473ab3`
- make/model: Toyota Land Cruiser Prado
- year: `2021`
- price: `45000`
- fuel: Diesel
- engine volume: `2.8`
- power: `204`
- transmission: Automatic
- drive: AWD
- mileage: `0`
- images: `10`
- city: Batumi
- create date: `28.08.2026 17:20`

The official WorldAuto UI independently labels sale prices in dollars and shows the same Toyota Land Cruiser Prado sample as `45000$`, year `2021`, engine `2.8 l`, diesel, AWD, Batumi.

## Rights/access blocker

Technical completeness is **not** sufficient for AvtoCena publication.

The current official WorldAuto public pages state that page content, including images, vehicle descriptions and details, is property of `worldauto.ge`; they state that this content may not be reused for profit by persons other than the seller who posted the vehicle, and that a link to `worldauto.ge` is required when using materials.

Because AvtoCena is a commercial catalog/calculation product, this public rights notice blocks treating WorldAuto as an automated publication source under the current evidence.

Decision:

- `class = lead_only`
- `publishAllowed = false`
- automated catalog reuse/republication: **blocked**
- allowed scope now: manual public reference/link-out only
- re-open automated qualification only after an explicitly permitted API/partner feed or written authorization covering commercial data reuse/republication is obtained

All WorldAuto qualification workflows created for this bounded investigation are retired after evidence capture so normal branch changes do not trigger more requests.

## Japan pause — owner direction

Japan is **not part of the active source-qualification queue now**.

Per owner direction on 2026-09-04:

- do not run new Japan qualification probes;
- do not merge the experimental Japan qualification branches into the active source path;
- the existing Japan entries in the research ledger are historical evidence only;
- resume Japan only after a candidate is identified that actually exposes completed/played auction lots under the required exact contract, and the owner explicitly resumes that market.

No currently verified Japan source in this project satisfies that completed-auction requirement. Fixed-price/export-stock candidates such as SBT/TCV/BE FORWARD do not establish completed-auction-lot coverage.

## Next active step

Continue only with non-Japan `research_pending` candidates, permission-first and no-write. The next qualification should target a source where prior evidence is closest to the exact contract rather than broadening WorldAuto or revisiting Japan.
