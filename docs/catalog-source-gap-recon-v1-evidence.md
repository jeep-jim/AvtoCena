# Catalog source gap recon v1 — evidence

Дата: 2026-09-03.

Этот checkpoint продолжает roadmap `40.25` и source-bound field audit. Он **не публикует каталог**, не меняет классы кандидатов и не даёт ни одному источнику право на production. Все проверки read-only/GET-only, robots.txt соблюдается, login/challenge не обходятся.

Машиночитаемая сводка: `data/catalog/source-gap-recon-v1-summary.json`.

## Проверенный запуск

- Workflow run: `33733192143` — `success`.
- Head SHA: `bef30942399f78e3785706ad3235c6cb6afef4eb`.
- Artifact: `9884697956`.
- Digest: `sha256:b5e1269987af32693d7f16a2008dd52789dfeaeacb69f2a20afeb2b8be48e681`.
- `8` фиксированных detail samples.
- Contract tests, generic gap recon, specialized extraction, no-write envelope и artifact upload — `success`.
- Safety envelope: `productionWrites=false`, `classificationMutations=false`, `publishAllowedMutations=false`, `rawBodiesStored=false`, `requestMethod=GET_only`, `challengeBypass=false`, `robotsBypass=false`.

## Что удалось закрыть

### Bobaedream

На обоих проверенных объявлениях теперь доказана listing-bound gallery.

Offer `2260063`:

- структурные gallery containers содержат до `40` изображений;
- `40` image tags имеют source alt `차량 썸네일 사진`;
- найден единый последовательный набор из `20` фотографий `_1.jpg ... _20.jpg` под одним upload prefix.

Offer `2262188`:

- тот же structural contract: до `40` изображений;
- `40` image tags с alt `차량 썸네일 사진`;
- последовательный набор `20` фотографий одного upload prefix.

По body источник передаёт `carshape=대형차`. Это source category «large/full-size car», а не однозначный canonical body type. Автоматически переводить `대형차` в `sedan` запрещено. Поэтому у Bobaedream после этого checkpoint остаётся **только `body` на 2/2 samples**.

### CarSwitch

Для обоих объявлений unit displacement теперь доказан самим visible detail рядом с идентичностью автомобиля:

- Chevrolet Captiva `864601`: `Premier Turbo 1.5L I4`; structured offer field `engineDisplacement=1.5` → `engineCc=1500`.
- Dodge Durango `857416`: `Crew 5.7L V8`; structured offer field `engineDisplacement=5.7` → `engineCc=5700`.

Таким образом прежняя неоднозначность единицы двигателя закрыта. Source-bound horsepower в проверенных representations не найден. После checkpoint у CarSwitch остаётся **только `powerHp` на 2/2 samples**.

### CARS24 UAE

На обоих detail samples цена и единица двигателя теперь связаны с конкретным offer-local state, а не только с общим текстом страницы.

Chevrolet Groove `9714841569`:

- visible detail: `AED 31,499` рядом с `2023 CHEVROLET GROOVE LT`;
- offer-local current-car state: `cars24Price=31499`, `price=31499`, `targetPrice=32999`, `marketPrice=34000`;
- `engineSize=1.5` и current-car highlight `1.5 L, 4 Cyl Engine` → `engineCc=1500`;
- `14` image tags содержат listing ID; structural gallery содержит до `16` изображений.

Ford Territory `9714841918`:

- visible detail: `AED 64,999` рядом с `2024 FORD TERRITORY TREND`;
- offer-local current-car state: `cars24Price=64999`, `price=64999`, `targetPrice=64999`, `marketPrice=66000`;
- `engineSize=1.8` и current-car highlight `1.8 L, 4 Cyl Engine` → `engineCc=1800`;
- `14` image tags содержат listing ID; structural gallery содержит до `15` изображений.

Из-за наличия других рекомендаций на странице посторонние цены не используются: в exact evidence попадает только совпадающее current-offer значение, подтверждённое одновременно visible detail и offer-local current-car state.

Source-bound horsepower пока не найден. После checkpoint у CARS24 остаётся **только `powerHp` на 2/2 samples**.

### DubiCars

Gallery identity закрыта на обоих samples через structural gallery и alt конкретной машины.

Hyundai Veloster `740206`:

- visible detail прямо содержит `2019 Hyundai Veloster 2.0L MPI Mid` → `engineCc=2000`;
- structural gallery содержит до `22` изображений;
- `22` image tags имеют alt `Hyundai Veloster`.

`powerHp` для этого ICE sample source-bound не найден.

BMW iX1 `979972`:

- structural gallery содержит до `19` изображений;
- `29` image tags имеют alt `BMW iX1 XDRIVE30 LUXURY M SPORT PACKAGE`;
- `313 HP` остаётся доказанной **peak horsepower**, но это не certified/utilization/30-minute power и не имеет права подменять требуемое расчётным контрактом значение.

После checkpoint у DubiCars остаётся: **`powerHp` на ICE sample 740206 и `certifiedPower` на EV sample 979972**.

## Текущий остаток по четырём сильнейшим кандидатам

| Источник | Осталось доказать |
| --- | --- |
| Bobaedream | canonical `body` — 2 samples |
| CarSwitch | `powerHp` — 2 samples |
| CARS24 UAE | `powerHp` — 2 samples |
| DubiCars | ICE `powerHp` — 1 sample; EV `certifiedPower` — 1 sample |

Ни один источник ещё не получает `exact_catalog`. Все остаются `research_pending`, `publishAllowed=false`.

## Следующая точка продолжения

Проверить только разрешённые публичные alternate representations / embedded source state для оставшихся полей:

1. Bobaedream — однозначный canonical body field, без model inference.
2. CarSwitch — source-bound horsepower.
3. CARS24 UAE — source-bound horsepower.
4. DubiCars — horsepower для ICE и certified/utilization/30-minute power для EV/Hybrid.

Если после bounded alternate-route probe конкретное обязательное поле источник не отдаёт, фиксировать это как доказанный source limitation и принимать решение `lead_only`/`rejected` либо ограниченный `exact_catalog` только для тех offer classes, где полный offer-level gate реально достижим. Production generation до отдельного решения не трогать.
