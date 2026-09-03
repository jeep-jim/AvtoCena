# Catalog source access/detail probe v1 — evidence

Статус: read-only qualification evidence. Этот документ **не разрешает публикацию** и сам по себе **не присваивает** `exact_catalog`, `lead_only` или `rejected`.

## Проверенные запуски

- Run `33726389159` — success, 33/33 кандидата, artifact `9882140294`, digest `sha256:06468bc8d6213dae0f9d513d9c5abe4e952d3719707b167b6d3a070c267839f6`, generated `2026-09-03T07:06:57.642Z`.
- Run `33726664183` — success, 33/33 кандидата, artifact `9882245749`, digest `sha256:b075fbd14e03fca4e3c5330ccf967570cb06d739ab08e63ba98503340f42d89b`, generated `2026-09-03T07:10:24.465Z`.
- В обоих контурах: `productionWrites=false`, `classificationMutations=false`, `publishAllowedMutations=false`; raw HTML bodies в artifact не сохраняются.

## Итог последнего прохода

- `challenge`: **10**
- `robots_disallowed`: **1**
- `network_error`: **1**
- `reachable_no_detail`: **13**
- `reachable_detail_sample`: **8**

Диагностическая триаж-группа `detail_full_signals` означает только то, что хотя бы на одном выбранном detail HTML присутствуют все 8 грубых маркеров (year/price/currency/mileage/fuel/engine/power/body) и найдено не менее 5 изображений. Это **не** доказательство точности значений, привязки к одному offer, list/detail parity, корректного типа кузова/силовой установки или готовности полного расчёта.

## Приоритет следующей ручной/структурной проверки

### Сильные detail-сигналы — проверить первыми

- `uae` / `dubicars_uae_exact` — DubiCars: `8/8` markers, 68 images; sample: https://www.dubicars.com/2023-bmw-ix1-979972.html
- `korea` / `bobaedream_korea_candidate` — Bobaedream: `8/8` markers, 46 images; sample: https://www.bobaedream.co.kr/mycar/mycar_view.php?no=2260063&gubun=K
- `uae` / `carswitch_uae_candidate` — CarSwitch: `8/8` markers, 73 images; sample: https://carswitch.com/abudhabi/used-car/dodge/durango/2013/857416
- `uae` / `cars24_uae_candidate` — CARS24 UAE: `8/8` markers, 76 images; sample: https://www.cars24.ae/buy-used-chevrolet-groove-2023-cars-dubai-9714841569/

### Detail доступен, но обязательные сигналы неполны

- `japan` / `carvector_japan_stat_open` — CarVector auction statistics: `8/8` markers, 1 images; sample: https://carvector.com/stat/ford/other/63ea2a26-fab3-4ae4-922e-9e23b498cd8f
- `china` / `chngoodcar_china_candidate` — Guangdong Good Car: `4/8` markers, 16 images; sample: https://www.chngoodcar.com/Home/Cars?id=1245159140309858930
- `china` / `iautos_china_candidate` — iAutos: `6/8` markers, 32 images; sample: https://m.iautos.cn/usedcar-15501828.html
- `japan` / `exportcar_japan_candidate` — ExportCar: `2/8` markers, 5 images; sample: https://exportcar.jp/auto/?id=00HOdwohiOavCuL

### Стабильно list-only в двух проверенных проходах

- `korea` / `kcar_korea_open` — K Car: https://www.kcar.com/
- `japan` / `jpauc_japan_past_open` — JPAuc completed auctions: https://jpauc.com/auction/past
- `japan` / `auctiondatasearch_japan_open` — Auction Data Search: https://www.auctiondatasearch.jp/
- `japan` / `jpcenter_japan_catalog_open` — JP Center: https://jp.center/
- `europe` / `autoscout_europe_open` — AutoScout24: https://www.autoscout24.com/lst
- `korea` / `kbchachacha_korea_candidate` — KB ChaChaCha: https://www.kbchachacha.com/public/search/main.kbc
- `japan` / `beforward_japan_candidate` — BE FORWARD: https://www.beforward.jp/
- `japan` / `sbtjapan_japan_candidate` — SBT Japan: https://www.sbtjapan.com/used-cars
- `japan` / `tcv_japan_candidate` — TCV: https://www.tc-v.com/allmakeslist/
- `uae` / `automarket_uae_candidate` — AutoMarket UAE: https://www.automarket.ae/uae/cars/used
- `georgia` / `worldauto_georgia_candidate` — WorldAuto: https://worldauto.ge/en/search/car

### Стабильный challenge в двух проходах

- `korea` / `encar_direct` — Encar: HTTP 200 / `��ī`
- `japan` / `prestige_japan_auctions_open` — Prestige Japan auctions: HTTP 403 / `Just a moment...`
- `uae` / `dubizzle_uae_open` — Dubizzle: HTTP 200 / `Pardon Our Interruption`
- `europe` / `mobile_de_open` — mobile.de: HTTP 403 / `Zugriff verweigert / Access denied`
- `georgia` / `myauto_georgia_list` — MyAuto: HTTP 403 / `Just a moment...`
- `georgia` / `autopapa_georgia_open` — AutoPapa: HTTP 403 / `Just a moment...`
- `japan` / `japaneseusedcars_japan_candidate` — JapaneseUsedCars: HTTP 403 / `Just a moment...`
- `uae` / `yallamotor_uae_candidate` — YallaMotor: HTTP 403 / `Just a moment...`
- `europe` / `lacentrale_europe_candidate` — La Centrale: HTTP 403 / `lacentrale.fr`
- `europe` / `autouncle_europe_candidate` — AutoUncle UK: HTTP 403 / `Just a moment...`

### Явный robots запрет

- `china` / `guazi_china_open` — Guazi: policy `explicitly_disallowed_by_robots`

### Нестабильный доступ

- `china` / `autohome_used_china_open` — Che168 / Autohome Used: previous `reachable_no_detail` → latest `network_error`

## Все 33 кандидата

| Market | sourceId | Run 7 | Run 9 | Triage | List/detail evidence |
|---|---|---|---|---|---|
| korea | `encar_direct` | `challenge` | `challenge` | `challenge` | list HTTP 200 |
| korea | `kcar_korea_open` | `reachable_no_detail` | `reachable_no_detail` | `list_only` | list HTTP 200 |
| china | `autohome_used_china_open` | `reachable_no_detail` | `network_error` | `network_unstable` | list HTTP — |
| china | `dongchedi_china_open` | `reachable_detail_sample` | `reachable_no_detail` | `list_only` | detail 1/8, 0 imgs |
| china | `guazi_china_open` | `robots_disallowed` | `robots_disallowed` | `robots_disallowed` | list HTTP — |
| china | `autohome_new_china_open` | `reachable_detail_sample` | `reachable_no_detail` | `list_only` | list HTTP 200 |
| japan | `jpauc_japan_past_open` | `reachable_no_detail` | `reachable_no_detail` | `list_only` | list HTTP 200 |
| japan | `carvector_japan_stat_open` | `reachable_detail_sample` | `reachable_detail_sample` | `detail_partial_signals` | detail 8/8, 1 imgs |
| japan | `prestige_japan_auctions_open` | `challenge` | `challenge` | `challenge` | list HTTP 403 |
| japan | `auctiondatasearch_japan_open` | `reachable_no_detail` | `reachable_no_detail` | `list_only` | list HTTP 200 |
| japan | `jpcenter_japan_catalog_open` | `reachable_no_detail` | `reachable_no_detail` | `list_only` | list HTTP 200 |
| uae | `dubizzle_uae_open` | `challenge` | `challenge` | `challenge` | list HTTP 200 |
| uae | `dubicars_uae_exact` | `reachable_detail_sample` | `reachable_detail_sample` | `detail_full_signals` | detail 8/8, 68 imgs |
| europe | `mobile_de_open` | `challenge` | `challenge` | `challenge` | list HTTP 403 |
| europe | `autoscout_europe_open` | `reachable_no_detail` | `reachable_no_detail` | `list_only` | list HTTP 200 |
| georgia | `myauto_georgia_list` | `challenge` | `challenge` | `challenge` | list HTTP 403 |
| georgia | `autopapa_georgia_open` | `challenge` | `challenge` | `challenge` | list HTTP 403 |
| korea | `kbchachacha_korea_candidate` | `reachable_no_detail` | `reachable_no_detail` | `list_only` | list HTTP 200 |
| korea | `bobaedream_korea_candidate` | `reachable_detail_sample` | `reachable_detail_sample` | `detail_full_signals` | detail 8/8, 46 imgs |
| china | `chngoodcar_china_candidate` | `reachable_detail_sample` | `reachable_detail_sample` | `detail_partial_signals` | detail 4/8, 16 imgs |
| china | `iautos_china_candidate` | `reachable_detail_sample` | `reachable_detail_sample` | `detail_partial_signals` | detail 6/8, 32 imgs |
| japan | `beforward_japan_candidate` | `reachable_no_detail` | `reachable_no_detail` | `list_only` | list HTTP 202 |
| japan | `exportcar_japan_candidate` | `reachable_detail_sample` | `reachable_detail_sample` | `detail_partial_signals` | detail 2/8, 5 imgs |
| japan | `japaneseusedcars_japan_candidate` | `challenge` | `challenge` | `challenge` | list HTTP 403 |
| japan | `sbtjapan_japan_candidate` | `reachable_no_detail` | `reachable_no_detail` | `list_only` | list HTTP 200 |
| japan | `tcv_japan_candidate` | `reachable_no_detail` | `reachable_no_detail` | `list_only` | list HTTP 200 |
| uae | `carswitch_uae_candidate` | `reachable_detail_sample` | `reachable_detail_sample` | `detail_full_signals` | detail 8/8, 73 imgs |
| uae | `yallamotor_uae_candidate` | `challenge` | `challenge` | `challenge` | list HTTP 403 |
| uae | `automarket_uae_candidate` | `reachable_no_detail` | `reachable_no_detail` | `list_only` | list HTTP 200 |
| uae | `cars24_uae_candidate` | `reachable_detail_sample` | `reachable_detail_sample` | `detail_full_signals` | detail 8/8, 76 imgs |
| europe | `lacentrale_europe_candidate` | `challenge` | `challenge` | `challenge` | list HTTP 403 |
| europe | `autouncle_europe_candidate` | `challenge` | `challenge` | `challenge` | list HTTP 403 |
| georgia | `worldauto_georgia_candidate` | `reachable_no_detail` | `reachable_no_detail` | `list_only` | list HTTP 200 |

## Что ещё требуется до классов

1. Для detail-кандидатов — извлечь **source-bound значения**, а не просто наличие слов: stable sourceOfferId/direct URL, make/model/year, actual price/currency, exact body, exact fuel/powertrain, exact engineCc или EV N/A, exact power, EV/hybrid certified power где требуется, same-car gallery.
2. Доказать list/detail identity и повторяемость одного и того же offer.
3. Отдельно проверить, что галерея содержит минимум 5 уникальных listing-bound изображений и не является общей галереей/плейсхолдером.
4. Для challenge/robots/list-only источников проверить только разрешённые публичные альтернативные маршруты/API; обход защит запрещён.
5. Только после этих доказательств менять `research_pending` на `exact_catalog`, `lead_only` или `rejected`. `publishAllowed` остаётся `false` до отдельного offer-level допуска.

## Следующая точка продолжения

Сначала пройти source-bound field audit для четырёх наиболее сильных кандидатов: `bobaedream_korea_candidate`, `dubicars_uae_exact`, `carswitch_uae_candidate`, `cars24_uae_candidate`. Затем тем же контрактом проверить `carvector_japan_stat_open`, `chngoodcar_china_candidate`, `iautos_china_candidate`, `exportcar_japan_candidate`. Никаких production writes, очистки каталога или автоматического `publishAllowed=true`.
