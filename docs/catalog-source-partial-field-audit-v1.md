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

## История выполнения

### Run 33747985524 — первый зелёный partial-signal field audit

- status: `success`;
- head: `f9d7ffdf5ecfa0d3ea963be48a501887ab9bb26f`;
- artifact: `9890402149`;
- digest: `sha256:d891247a0217a5e5155f3a089538ef63f4e1588c0e4f0d206d515161db0e4ec6`;
- 4/4 известных detail samples проверены дважды;
- contract tests, no-write envelope и artifact upload — `success`;
- машиночитаемая сводка: `data/catalog/source-partial-field-audit-v1-summary.json`.

Фактический результат:

1. **CarVector / Japan**
   - sample повторно доступен, но остаётся именно `Statistics for Hitachi EX55UR-3 1998`;
   - page-role audit одновременно фиксирует statistics language и heavy-machinery sample;
   - embedded state содержит `year=1998`, `currency=JPY`, `mileage=13`, но `power=0`; make/model/body/fuel/engine/price как exact named fields не доказаны;
   - обнаружено только 2 image identities, из них vehicle-state stub и favicon; offer-scoped gallery >=5 отсутствует;
   - текущий public route не является standalone passenger-car offer. Для `exact_catalog` дальнейшее точечное лечение без найденного passenger-vehicle offer route нецелесообразно.

2. **Guangdong Good Car / China**
   - страница `众泰 云100S` доступна и содержит >5 offer-near image identities;
   - в основном vehicle spec context найдены `最大马力 37 Ps` и `最大功率 27kw`, рядом присутствуют charging-time данные — это сильный сигнал реального EV specification блока;
   - одновременно на странице есть recommendation cards с чужими `1.8L / 1.6L`, поэтому общий поиск engine units **не может** приписывать их текущему Yun100S;
   - named currency по текущему sample не доказана;
   - страница сама дала несколько конкретных same-origin `Home/Cars?id=...` routes для второго offer sample. Следующий probe использует только эти реально обнаруженные ID.

3. **iAutos / China**
   - exact offer `15501828` доступен; title и visible detail подтверждают BMW 3 Series 325i 2020;
   - offer text явно показывает `排量 2.0L`, `自动`, `中型车`, first-registration/mileage blocks и CNY-style `￥` цены;
   - fuel и power как source-bound fields не найдены;
   - пять найденных image URL — placeholder/UI/logo assets, то есть listing gallery пока **не доказана**;
   - страница сама отдала same-offer route `https://m.iautos.cn/configuration-15501828/` и несколько конкретных second-offer URLs. Сначала проверяется только configuration route того же offer.

4. **ExportCar / Japan**
   - два запроса дают стабильный evidence fingerprint;
   - title остаётся generic `Auto Auctions`;
   - named vehicle fields отсутствуют полностью;
   - 6 image URL — logo/language/site chrome, offer-scoped gallery нет;
   - текущий public vehicle-like URL фактически является generic auction shell. Без нового реально обнаруженного vehicle route дальнейшее exact-исследование этого маршрута останавливается.

## Следующая точка

1. Выполнить robots-aware read-only probe только **обнаруженных** Guangdong Good Car second-offer routes, чтобы проверить, повторяется ли source-bound price/powertrain/power/gallery contract на другой машине и можно ли отделить vehicle core от recommendation cards.
2. Выполнить same-offer probe `https://m.iautos.cn/configuration-15501828/`; если он даёт exact fuel/power/cc/body и identity-bound связь с `15501828`, только тогда брать один уже обнаруженный second offer.
3. CarVector и ExportCar не лечить дальше по текущим маршрутам: вернуться к ним только если появится конкретный public passenger-vehicle/detail route.
4. Никаких class/publish mutations до второго evidence checkpoint; Китай и Япония всё ещё не публикуются.
