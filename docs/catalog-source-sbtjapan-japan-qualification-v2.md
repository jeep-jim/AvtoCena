# SBT Japan — source qualification v2

Дата: 2026-09-04

Источник: `sbtjapan_japan_candidate`

Рабочая ветка: `feat/sbtjapan-japan-qualification-v1-20260904`

## Вердикт

`lead_only`, `publishAllowed=false`.

SBT Japan подтверждён как реальный публичный fixed-price lead/search источник для Японии. Разрешённый read-only маршрут `https://www.sbtjapan.com/used-cars/search` на GitHub runner вернул HTTP `200`, полный HTML без challenge и 49 source-declared карточек, которые v2-парсер смог жёстко связать с URL конкретного stock ID и полями внутри того же listing anchor.

На 4/4 выбранных source-declared detail URL повторный запрос дважды дал стабильную identity/price/detail parity. Однако ни одна из четырёх карточек не прошла exact-card gate: source-bound power отсутствует/неоднозначен на 4/4, а listing-bound gallery доказана >=5 только на одном из четырёх примеров. Для гибридного примера также отсутствует required certified power.

Следовательно, SBT Japan полезен как `lead_only`, но не как самостоятельный `exact_catalog` источник и не может автоматически публиковать карточки или запускать полный расчёт без дополнительного exact evidence.

## Safety boundary

На всём этапе:

- `productionWrites=false`;
- `classificationMutations=false` во время probe;
- `publishAllowedMutations=false` во время probe;
- `objectStorageWrites=false`;
- `catalogGenerationWrites=false`;
- `rawBodiesStored=false`;
- `guessedRoutes=false`;
- `sourcePublishAllowed=false`;
- production registry, public catalog generation и object storage не изменялись.

## Public source contract

Проверенный source-declared list URL:

`https://www.sbtjapan.com/used-cars/search`

В run `33838661415` list response:

- HTTP `200`;
- final URL совпал с source-declared search URL;
- response size: `4,135,272` bytes;
- `truncated=false`;
- challenge detector: `false`;
- `discoveredCandidateCount=49`;
- list SHA-256: `c6645c439bd65850b213ed72787ea4a90fd61bdda5ba5118eb4c5af5c8abbfac`.

V2 discovery принимает detail URL только если URL имеет source-declared формат `/used-cars/{stockId}`, а внутри того же `<a>` присутствуют `Vehicle Price`, `Stock Id`, year/month и валидная цена. Видимый `Stock Id` обязан совпадать с stock ID из URL; конфликтующая карточка отбрасывается.

## Run 33838661415 — card-bound SBT Japan qualification v2

Статус: `success`.

Head SHA: `319d1f7faa6c33ced2d9956496cc1d8bc670cf96`.

Artifact: `9924186893` — `catalog-source-sbtjapan-japan-qualification-v2`.

Artifact size: `3012` bytes.

Artifact digest: `sha256:deb5411bb3f8e8344c88cc3cf469a3e753dea0830f59ae1fc11ed9394ea650ce`.

Evidence generated at: `2026-09-04T04:58:40.219Z`.

Итог artifact:

- `candidateCount=49`;
- `sampled=4`;
- `stableReachable=4`;
- `identityPriceStable=4`;
- `exactReady=0`;
- `powerMissing=4`;
- `sourceVerdict=lead_only_signal`;
- `sourcePublishAllowed=false`.

Workflow также прошёл v2 card-binding regression tests, project typecheck, fail-closed evidence-envelope check и artifact upload.

## Source-declared sample evidence

Все четыре detail URL были взяты из source-declared search HTML и каждый запрошен дважды.

1. `AR1829` — 2017/5 Daihatsu Mira ES L SA — USD `1,760`, `77,000 km`, `660 cc`, Petrol, Kobe, Japan. Identity/year/price/currency/mileage/engine/fuel/body exact; `power=missing_or_ambiguous`; listing-bound gallery count `1`. Deficits: `power`, `gallery`.
2. `AP9798` — 2015/9 Suzuki Swift XG — USD `2,040`, `102,000 km`, `1,242 cc`, Petrol, Nagoya, Japan. Identity/year/price/currency/mileage/engine/fuel/body exact; `power=missing_or_ambiguous`; listing-bound gallery count `14`. Deficit: `power`.
3. `AQ8386` — 2018/12 Toyota Corolla Sport Hybrid G Z — USD `6,890`, `39,000 km`, `1,800 cc`, `HYBRID(PETROL)`, Nagoya, Japan. Identity/year/price/currency/mileage/engine/fuel/body exact; `power=missing_or_ambiguous`; `certifiedPower=missing`; listing-bound gallery count `1`. Deficits: `power`, `certifiedPower`, `gallery`.
4. `AR1824` — 2020/6 Suzuki Alto F — USD `2,010`, `79,000 km`, `660 cc`, Petrol, Osaka, Japan. Identity/year/price/currency/mileage/engine/fuel/body exact; `power=missing_or_ambiguous`; listing-bound gallery count `1`. Deficits: `power`, `gallery`.

На всех четырёх samples `powerTokens=[]`; никакое значение мощности не подставлялось из fallback, энциклопедии или догадки.

## Классификационное решение

`lead_only` — потому что SBT Japan даёт repeatable offer identity, price, year, mileage, exact engine cc, fuel и body на проверенных detail страницах, но текущий exact-card contract требует также source-bound power и достаточную listing-bound gallery evidence; для electrified offer требуется certified power.

Это **не** `rejected`: источник даёт реальный, стабильный и offer-bound stock lead feed.

Это **не** `exact_catalog`: `exactReady=0/4`, `powerMissing=4/4`, gallery >=5 доказана только на 1/4 sample, а гибридный sample не имеет required certified power.

`publishAllowed` остаётся `false`.

## Следующий шаг

Не подключать SBT Japan напрямую к production generation. Зафиксировать его в durable source ledger как `lead_only`, затем продолжить квалификацию следующего Japan fixed-price кандидата по тому же source-bound/no-write контракту. Если SBT позже даст разрешённый source-bound power/certified-power route и стабильную listing-bound gallery, повторить exact qualification отдельным run.
