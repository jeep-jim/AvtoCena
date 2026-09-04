# TCV Japan — source qualification v1

Дата: 2026-09-04

Источник: `tcv_japan_candidate`

Рабочая ветка: `feat/tcv-japan-anatomy-v1-20260904`

## Финальный вердикт

`lead_only`, `publishAllowed=false`.

TCV подтверждён как реальный публичный fixed-price lead/search источник для Японии. Source-declared list route `https://www.tc-v.com/used_car/all/all/` доступен без обхода защиты и связывает listing ID с конкретным detail URL. На четырёх уникальных source-declared detail карточках два последовательных read-only запроса подтвердили стабильные identity, USD price, year, mileage, exact engine cc, fuel, canonical body и listing-bound gallery.

Источник **не** повышается до `exact_catalog`, потому что текущий exact-контракт запрещает считать свободный seller/title text доказанной мощностью. На трёх из четырёх samples TCV действительно показывает offer-local `260PS`/`280PS`, но эти токены находятся в названии/remarks/comment, а не в структурированном или именованном power field. Четвёртый sample вообще не содержит power token. После обязательного strict provenance review `exactReady=0/4`, `powerMissing=4/4`.

## Почему первоначальный v1 signal был понижен

Первый qualification parser специально собирал bare `HP/PS/kW` токены из offer-local specific-information text, чтобы увидеть фактическую анатомию страницы. На run `33848501969` это дало предварительный `exact_catalog_signal_requires_manual_review`: три из четырёх samples формально прошли matrix, потому что `260PS`/`280PS` были связаны с конкретной карточкой.

Ручная проверка относительно уже зафиксированного project exact contract обнаружила более строгий blocker: свободный текст без привязанной метки не может повышаться до exact power. Поэтому был добавлен отдельный strict review, который не подменяет и не угадывает мощность, а fail-closed отклоняет все v1 bare power tokens до появления доказанного named/structured power provenance.

Это намеренное ужесточение, а не ошибка источника или сети.

## Safety boundary

На всех probe/review этапах:

- `productionWrites=false`;
- `classificationMutations=false` во время probe;
- `publishAllowedMutations=false` во время probe;
- `objectStorageWrites=false`;
- `catalogGenerationWrites=false`;
- `rawBodiesStored=false`;
- `guessedRoutes=false`;
- `sourcePublishAllowed=false`;
- challenge/captcha не обходились;
- production registry, current public generation, Object Storage и cleanup не изменялись.

## Source-declared list contract

Проверенный route:

`https://www.tc-v.com/used_car/all/all/`

В финальном strict-review input list response:

- HTTP `200`;
- final URL совпал с source-declared route;
- response size `257,062` bytes;
- `truncated=false`;
- challenge detector `false`;
- `discoveredCandidateCount=25` уникальных card-bound listing IDs в bounded first-page discovery;
- list SHA-256 `b4e55643568c61aab902da016cdc011b4a4ca84caf94c9d47c72ddcb7460f0ca`.

Discovery принимает detail URL только формата `/used_car/{make}/{model}/{listingId}/` на `www.tc-v.com` и связывает его с тем же `data-car-id`. Повторные маркеры одной карточки дедуплицируются; конфликтующий listing ID не принимается.

## Anatomy run 33848060452

Статус: `success`.

Artifact `9927270739` — `catalog-source-tcv-japan-anatomy-v1`.

Digest: `sha256:402ae0b5af924a03cdb76031f46d71456603662ec6ba6e980fdc4eb6bb2dcfad`.

Anatomy доказал публичную повторную detail-доступность и listing-bound gallery, но первый extractor видел повторяющиеся anchors одной карточки и не был достаточен для финальной выборки. Поэтому финальная qualification использует deduplicated `data-car-id` segmentation.

## Qualification run 33848501969

Статус: `success`.

Head SHA: `907d8d749f948ddeb8ac48c18a26dc7032fe7dd3`.

Artifact `9927435958` — `catalog-source-tcv-japan-qualification-v1`.

Digest: `sha256:454e6a3b98a88108f0736228ed36803143f58c1b9331ff44faf63f4241a3b7e1`.

Pre-review result:

- `candidateCount=25`;
- `sampled=4` уникальных listings;
- `stableReachable=4`;
- `identityPriceStable=4`;
- preliminary `exactReady=3`;
- preliminary `powerMissing=1`;
- preliminary source verdict `exact_catalog_signal_requires_manual_review`.

Этот verdict **не является финальной классификацией**, потому что v1 matrix ещё не различал structured power field и offer-local free text.

## Strict provenance review run 33848807473

Статус: `success`.

Head SHA: `bc0d459b90a31bac379973529b54649c11021220`.

Artifact `9927543644` — `catalog-source-tcv-japan-strict-review-v1`.

Digest: `sha256:ace0cfd48f0f62de03570c8266283dd0bdeb3c8d88d946d5196a876745803e2f`.

Strict evidence generated at `2026-09-04T07:28:01.960Z`.

Финальный strict result:

- `candidateCount=25`;
- `sampled=4`;
- `stableReachable=4`;
- `identityPriceStable=4`;
- `exactReady=0`;
- `powerMissing=4`;
- `unstructuredPowerRejected=3`;
- `sourceVerdict=lead_only_signal`;
- `sourcePublishAllowed=false`.

Workflow прошёл parser regression tests, strict provenance tests, повторный read-only live qualification, fail-closed review и artifact upload.

## Source-declared sample evidence

Все четыре URL были извлечены из source list и каждый detail запрошен дважды.

1. `43814804` — 2000 Subaru Legacy Touring Wagon — USD `2,664`, `86,350 km`, `2,000 cc`, Gasoline/Petrol, body `Wagon`, listing-bound images `25`. Identity/year/price/currency/mileage/engine/fuel/body/gallery стабильны. Offer-local text содержит `260PS`, но named/structured power field не доказан. Deficit: `power`.
2. `43847281` — 2001 Nissan Cima — USD `2,567`, `64,100 km`, `3,000 cc`, Gasoline/Petrol, body `Sedan`, listing-bound images `28`. Offer-local title/remarks содержат `280PS`, но named/structured power field не доказан. Deficit: `power`.
3. `43810106` — 1999 Mazda Roadster — USD `2,182`, `141,300 km`, `1,600 cc`, Gasoline/Petrol, body `Convertible`, listing-bound images `26`. Power token отсутствует. Deficit: `power`.
4. `42876757` — 2000 Subaru Legacy Touring Wagon — USD `2,375`, `159,450 km`, `2,000 cc`, Gasoline/Petrol, body `Wagon`, listing-bound images `30`. Offer-local text содержит `260PS`, но named/structured power field не доказан. Deficit: `power`.

Годы этих четырёх bounded samples не используются как доказательство coverage целевого Japan production range; run квалифицирует доступность и field provenance source contract, а не полноту текущего рынка.

## Классификационное решение

`lead_only` — потому что TCV даёт повторяемые offer-bound identity, fixed USD price, year, mileage, exact engine cc, fuel, body и большую listing-bound gallery, но не доказал структурированную/именованную мощность, обязательную для автоматического полного расчёта АвтоЦены.

Это **не** `rejected`: источник содержит реальные стабильные fixed-price stock offers и пригоден для поиска/lead evidence.

Это **не** `exact_catalog`: после применения действующего power provenance contract `exactReady=0/4`, `powerMissing=4/4`. Три наблюдаемых `260PS/280PS` намеренно не повышены до exact, потому что они происходят из свободного offer-local текста без доказанного power label.

`publishAllowed` остаётся `false`.

## Следующий шаг

Зафиксировать TCV в durable source ledger как `lead_only` и продолжить квалификацию следующего Japan `research_pending` кандидата тем же read-only source-bound contract. TCV можно повторно рассмотреть только если будет доказан source-declared named/structured power route либо иной разрешённый exact power evidence, который не является free-text inference. Production promotion остаётся отдельным решением.
