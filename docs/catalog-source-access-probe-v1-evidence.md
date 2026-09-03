# Catalog source access/detail probe v1 — evidence

Статус: read-only qualification evidence. Этот документ **не разрешает публикацию** и сам по себе **не присваивает** `exact_catalog`, `lead_only` или `rejected`.

Машиночитаемая сводка: `data/catalog/source-access-probe-v1-summary.json`.

## Два повторных проверенных запуска

- Run `33726664183` — success, `33/33`, artifact `9882245749`, digest `sha256:b075fbd14e03fca4e3c5330ccf967570cb06d739ab08e63ba98503340f42d89b`, generated `2026-09-03T07:10:24.465Z`.
  - `challenge=10`
  - `reachable_no_detail=13`
  - `network_error=1`
  - `robots_disallowed=1`
  - `reachable_detail_sample=8`
- Run `33727078764` — success, `33/33`, artifact `9882393538`, digest `sha256:e44c808f0fec85d3856cfa09c7d267a9ea637e4036f65241ac2e103fd7c1ef32`, generated `2026-09-03T07:15:16.655Z`.
  - `challenge=10`
  - `reachable_no_detail=12`
  - `network_error=2`
  - `robots_disallowed=1`
  - `reachable_detail_sample=8`
- В обоих контурах: `productionWrites=false`, `classificationMutations=false`, `publishAllowedMutations=false`; raw HTML bodies в artifact не сохраняются.
- Новый probe уважает explicit robots `Disallow`, не обходит login/bot challenge, перепроверяет robots при redirect и не импортирует production publishers/storage writers.

## Что доказано и что пока не доказано

`detail_full_signals` — только диагностическая группа: на выбранной detail-странице одновременно присутствуют грубые маркеры year/price/currency/mileage/fuel/engine/power/body и найдено минимум пять image URL. Это **не** является доказательством source-bound значений, корректности кузова/силовой установки, list/detail parity, принадлежности всех изображений одной машине или готовности полного расчёта.

Поэтому после этих запусков все `33` кандидата остаются `research_pending`, а `publishAllowed=false` остаётся у всех без исключения.

## Приоритет source-bound field audit

### Четыре strongest detail-signal кандидата

- `uae` / `dubicars_uae_exact` — DubiCars: повторно доступен detail. Sample `https://www.dubicars.com/2023-bmw-ix1-979972.html`: `8/8` грубых markers, `68` image URL, JSON-LD содержит `Product` и `Car` и ключи `brand`, `model`, `vehicleModelDate`, `offers`, `mileageFromOdometer`, `bodyType`, `fuelType`.
- `korea` / `bobaedream_korea_candidate` — Bobaedream: повторно доступен detail. Sample `https://www.bobaedream.co.kr/mycar/mycar_view.php?no=2262188&gubun=K`: `8/8`, `46` image URL.
- `uae` / `carswitch_uae_candidate` — CarSwitch: повторно доступен detail. Sample `https://carswitch.com/abudhabi/used-car/dodge/durango/2013/857416`: `8/8`, `73` image URL, JSON-LD содержит `Car`/`Product`, `vehicleIdentificationNumber`, `brand`, `model`, `vehicleModelDate`, `mileageFromOdometer`, `bodyType`, `vehicleEngine`, `offers`.
- `uae` / `cars24_uae_candidate` — CARS24 UAE: повторно доступен detail. Sample `https://www.cars24.ae/buy-used-ford-territory-2024-cars-dubai-9714841918/`: `8/8`, `76` image URL. В видимом JSON-LD sample найден только `BreadcrumbList`, поэтому обязательные поля ещё надо привязать к конкретным именованным данным страницы/embedded state.

### Detail доступен, но сигналов недостаточно

- `japan` / `carvector_japan_stat_open` — `8/8` грубых markers, но только `1` image URL; выборка также включает `Hitachi EX55UR-3`, то есть общая статистическая лента смешивает легковые автомобили с техникой и не является standalone public-card источником.
- `china` / `chngoodcar_china_candidate` — `4/8`, `15–16` image URL; не доказаны currency/fuel/engine/body как source-bound поля.
- `china` / `iautos_china_candidate` — `6/8`, `31–32` image URL; не доказаны fuel/power как source-bound поля.
- `japan` / `exportcar_japan_candidate` — `2/8`, `5` image URL; текущая sample detail недостаточна для exact-контракта.

## Стабильные группы по двум последним проходам

### Challenge в обоих проходах

`encar_direct`, `prestige_japan_auctions_open`, `dubizzle_uae_open`, `mobile_de_open`, `myauto_georgia_list`, `autopapa_georgia_open`, `japaneseusedcars_japan_candidate`, `yallamotor_uae_candidate`, `lacentrale_europe_candidate`, `autouncle_europe_candidate`.

Фактические примеры: mobile.de — HTTP `403`, `Zugriff verweigert / Access denied`; Dubizzle — HTTP `200`, `Pardon Our Interruption`; Prestige/MyAuto/AutoPapa/YallaMotor/AutoUncle/JapaneseUsedCars — challenge/403 shell. Защиты не обходятся.

### Explicit robots disallow в обоих проходах

- `china` / `guazi_china_open` — policy `explicitly_disallowed_by_robots`.

### List-only в обоих проходах

`dongchedi_china_open`, `jpauc_japan_past_open`, `auctiondatasearch_japan_open`, `jpcenter_japan_catalog_open`, `autoscout_europe_open`, `kbchachacha_korea_candidate`, `beforward_japan_candidate`, `sbtjapan_japan_candidate`, `tcv_japan_candidate`, `automarket_uae_candidate`, `worldauto_georgia_candidate`.

Dongchedi дополнительно показал переход найденных dealer-like route на `/login-required?...`; такие переходы не считаются detail evidence.

### Network unstable между двумя проходами

- `kcar_korea_open`: `reachable_no_detail → network_error`.
- `autohome_used_china_open` / Che168: `network_error → reachable_no_detail`.
- `autohome_new_china_open`: `reachable_no_detail → network_error`.

Ни один из этих случаев не повышается до `exact_catalog` и не отклоняется только на основании одного сетевого сбоя.

## Что требуется до присвоения класса

1. Для detail-кандидатов извлечь **значения**, а не наличие слов: stable `sourceOfferId`/direct URL, make/model/year, actual price/currency, exact body, exact fuel/powertrain, exact engineCc или EV `not_applicable`, exact power, EV/hybrid certified power где требуется, listing-bound gallery.
2. Доказать list/detail identity и повторяемость одного и того же offer на повторном запросе.
3. Проверить минимум пять уникальных listing-bound изображений и исключить logo/recommendation/common gallery.
4. Для challenge/robots/list-only источников исследовать только разрешённые публичные alternate routes/API/partner feed. Обход защит запрещён.
5. Только после этих доказательств менять `research_pending` на `exact_catalog`, `lead_only` или `rejected`.
6. Даже после source-level `exact_catalog` `publishAllowed` не становится `true` автоматически: каждая карточка отдельно проходит offer-level exact gate.

## Следующая точка продолжения

Сначала выполнить source-bound field audit для `bobaedream_korea_candidate`, `dubicars_uae_exact`, `carswitch_uae_candidate`, `cars24_uae_candidate`. Затем тем же контрактом проверить `carvector_japan_stat_open`, `chngoodcar_china_candidate`, `iautos_china_candidate`, `exportcar_japan_candidate`. Production writes, cleanup и автоматическое `publishAllowed=true` запрещены.
