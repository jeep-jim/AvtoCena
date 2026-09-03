# Catalog source partial-signal field audit v1

Дата старта: 2026-09-03.

## Точка продолжения

Работа продолжается после merge PR #827, merge SHA `b5573a51a55d4c350c795077684b464dfcd7dbcb`. Раздел `roadmap.md` 40.26 зафиксировал итог strongest-группы: Bobaedream, CarSwitch, CARS24 UAE и DubiCars не получили `exact_catalog`; все остаются `research_pending`, `publishAllowed=false`, а production не изменялся.

Следующий основной блок из исходного access/detail probe — четыре `detail_partial_signals` кандидата:

1. `japan / carvector_japan_stat_open`
   - известный sample: `https://carvector.com/stat/hitachi/ex55ur-3/ab29a1a3-d845-41fb-a9f8-20a7e4282c6f`;
   - прежний probe видел 8/8 грубых маркеров, но только одну картинку;
   - sample — Hitachi EX55UR-3, то есть техника, а не легковой автомобиль; статистическая лента смешивает категории.
2. `china / chngoodcar_china_candidate`
   - sample: `https://www.chngoodcar.com/Home/Cars?id=1245159140309858930`;
   - прежний probe: 4/8 маркеров, 15–16 image URL;
   - не доказаны currency/fuel/engine/body как source-bound поля.
3. `china / iautos_china_candidate`
   - sample: `https://m.iautos.cn/usedcar-15501828.html`;
   - прежний probe: 6/8 маркеров, 31–32 image URL;
   - не доказаны fuel/power как source-bound поля.
4. `japan / exportcar_japan_candidate`
   - sample: `https://exportcar.jp/auto/?id=27qDVYVBkJg1fdu`;
   - прежний probe: 2/8 маркеров и 5 image URL;
   - текущая detail-страница недостаточна для exact-контракта.

## Цель этапа

Не пытаться «дотянуть» площадку до exact. Для каждого известного detail sample повторно и read-only проверить только реальные source-bound evidence:

- stable offer/detail identity и canonical URL;
- make/model/year;
- actual price + currency;
- canonical body;
- exact fuel/powertrain;
- exact engineCc либо доказанное EV `not_applicable`;
- exact peak power;
- certified/utilization/30-minute power для EV/hybrid, если требуется контрактом;
- listing-bound gallery >=5;
- признаки того, что страница вообще является самостоятельным vehicle offer/result, а не общей статистикой, модельной страницей или mixed-category shell.

Первый проход использует только четыре уже известные detail URL и делает два запроса каждого URL. Новые offer URL автоматически не угадываются. Если на странице обнаруживается конкретный same-origin vehicle/list/detail route, он только сохраняется как candidate route для следующего отдельного probe.

## Классификационная граница

- `exact_catalog` не присваивается по одному sample и не присваивается автоматически этим workflow;
- если source явно не способен дать required exact fields, результат должен направлять к `lead_only` или `rejected`, а не к бесконечному repair;
- CarVector отдельно проверяется на смешение легковых машин и спецтехники/auction statistics;
- Китай и Япония на этом этапе **не публикуются** независимо от результата исследования.

## Safety boundary

- `productionWrites=false`;
- `classificationMutations=false`;
- `publishAllowedMutations=false`;
- `rawBodiesStored=false`;
- production generation, manifest, Object Storage, cleanup и публикация не затрагиваются;
- robots/login/challenge не обходятся.

## Следующая точка

Запустить read-only partial field audit по четырём известным samples, сохранить artifact и evidence matrix. Только после просмотра результата решать, какие из источников заслуживают второй vehicle sample или discovered-route probe, а какие уже достаточно доказанно ограничены до `lead_only/rejected`.
