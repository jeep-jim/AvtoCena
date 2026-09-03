# Catalog source deficit reconnaissance v1

Дата старта: 2026-09-03.

## Точка, с которой продолжаем

PR #826 (`3826f80b04371ba8c4c0b8a3321292fa93bf5db2`) влит в `main`. Read-only source-bound field audit четырёх сильнейших кандидатов завершён зелёным checkpoint run `33731675254`, artifact `9884112823`, digest `sha256:4dc1b6fa50e7607676d5723b9465dc75cb98f5be6f4c345ad56bd980bd7358f8`.

Ни один кандидат не получил `exact_catalog`: все остаются `research_pending`, `publishAllowed=false`.

Незакрытые доказательства на входе этапа:

- Bobaedream: canonical body type и listing-bound gallery >=5;
- CarSwitch: явная единица displacement / exact `engineCc` и source-bound `powerHp`;
- CARS24 UAE: offer-bound price, явная единица displacement / exact `engineCc`, `powerHp`;
- DubiCars: ICE `engineCc`/`powerHp`, gallery identity; для EV/Hybrid — certified/utilization/30-minute power, если источник её реально предоставляет.

## Что делает этот этап

Это **не новый общий probe и не повтор предыдущей работы**. Он смотрит только на восемь уже проверенных detail URL и сохраняет диагностические доказательства, необходимые для закрытия перечисленных дефицитов:

- source-like key/value contexts в embedded state;
- same-origin route candidates, связанные с API/spec/gallery/detail/offer;
- scoped gallery clusters и признак наличия offer ID в том же фрагменте;
- body-type contexts;
- повторяемость evidence fingerprint между двумя запросами.

На первом проходе alternate routes только обнаруживаются, но автоматически не запрашиваются. После просмотра evidence разрешённые публичные маршруты добавляются точечно. Это не позволяет случайно начать обход challenge/login/robots или превратить исследовательский crawler в production parser.

## История выполнения

### Run 33744503461 — regression в новом recon, исправлен

Первый рабочий запуск новой ветки дошёл до contract tests и остановился на тесте redaction: JSON-подобное поле `"authorization":"Bearer ..."` не полностью скрывалось старым regex. Сам source recon не запускался и production не затрагивался.

Исправление: secret-like JSON keys и Bearer values теперь редактируются отдельно; регрессионный тест оставлен как обязательная граница безопасности.

### Run 33744960785 — зелёный targeted recon

- status: `success`;
- head: `f9d554b85c1c7608e435df19ce328fe3c66b7eb0`;
- artifact: `9889257990`;
- digest: `sha256:d7008f31989b6fac8f941349122c1da63a72e2593866b199ed73140310b010db`;
- 8/8 detail samples проверены повторно;
- contract tests, no-write envelope и artifact upload — `success`.

Фактические новые находки:

1. **Bobaedream**
   - обе detail-страницы доступны;
   - найден offer-bound блок `gallery-data` с `16–17` уникальными image identities рядом с конкретным offer ID — это сильное доказательство, что предыдущий deficit `gallery` можно закрыть после консервативной нормализации series/thumbnail variants;
   - для обоих offers найден официальный same-origin spec route вида `/dealguide/carinfo.php?cat=spec&maker_no=...&model_no=...&level_no=...&class_no=...&year_no=2016`;
   - body contexts текущей detail-страницы содержат в основном навигационные/общие слова и сами по себе **не доказывают canonical body**.

2. **CarSwitch**
   - обе detail-страницы byte-stable между двумя запросами;
   - JSON-LD стабильно даёт offer price/currency, body/fuel и `engineDisplacement` (`1.5` / `5.7`), но само structured поле не содержит unit;
   - route discovery не нашёл отдельного offer API/spec endpoint, кроме detail/manifest и общих search routes;
   - поэтому `powerHp` остаётся недоказанным, а `engineCc` пока не повышается только на основании безразмерного JSON-LD значения.

3. **CARS24 UAE**
   - detail остаётся доступным;
   - embedded evidence даёт `fuelType`, `bodyType`, `engineSize` (`1.5` / `1.8`), но без достаточной source-bound единицы в текущем JSON evidence;
   - общий `priceRange` относится к convenience fee и не является ценой автомобиля;
   - offer-specific price/power route в первом same-origin discovery не найден;
   - source всё ещё не готов к `exact_catalog`.

4. **DubiCars**
   - обе detail-страницы byte-stable;
   - embedded state стабильно содержит offer-bound `content_ids`, local/export/discounted price, fuel/body, `image_count` (`11` ICE / `14` EV) и image URL;
   - offer-bound gallery clusters найдены на обеих страницах, но их URL надо дедуплицировать по underlying image identity, потому что одна фотография встречается в нескольких размерных вариантах;
   - ICE sample по-прежнему не даёт доказанных listing-bound `engineCc/powerHp`;
   - EV sample по-прежнему не даёт требуемую certified/utilization/30-minute power.

### Run 33745638721 — зелёный probe только найденных Bobaedream spec routes

- status: `success`;
- artifact: `9889505193`;
- digest: `sha256:5ec558b74397826ba513f1798e0a078615f97fc9ec4f8fe1da3e0056a7ea50d5`;
- `guessedRoutes=false`: проверялись только два same-origin route, реально найденные предыдущим run;
- оба маршрута повторно дали HTTP 200 с одинаковыми body hash и evidence fingerprint.

Результат:

- для `2260063` spec page title точно соответствует `Kia All New K7 2.4 GDi Prestige`, то есть route/trim binding сильный;
- для `2262188` route также стабилен, но title менее информативен;
- ни один из двух spec routes не содержит отдельного offer-bound canonical body field;
- `차체(길이x너비x높이mm)` означает габариты кузова, а не тип кузова;
- `차종국가 한국` означает страну/категорию происхождения, а не sedan;
- слова `승용`, `SUV`, `쿠페` в найденных contexts относятся к общей навигации/спискам моделей и не могут быть повышены до offer-bound body evidence.

**Вывод:** Bobaedream gallery выглядит технически закрываемой после нормализации image series, но `body` остаётся настоящим source deficit. Никакого `sedan` из собственной энциклопедии или знания модели не подставляем.

## Дополнительная публичная разведка, не являющаяся классификацией

Публичные страницы самих источников показали важное направление для следующей машинной проверки:

- CarSwitch на exact used offer подписывает двигатель прямо в названии (`1.5L I4`, `5.7L V8`), а его 2025 Captiva model page показывает `144 BHP` и `1498 cc` и одновременно выводит audited 2025 Premier Turbo listing. Это сильный кандидат на источник связанного specification evidence, но year/variant binding должен быть доказан машинно; текущие 2026 страницы нельзя автоматически переносить на старые предложения.
- CARS24 exact offer page визуально показывает `Engine 1.8L` и `AED 64,999`; следовательно часть дефицита — недостаток нашего extraction, а не отсутствие данных на странице. Но `powerHp` и exact cc всё ещё не доказаны.

Эти находки не меняют class и `publishAllowed` сами по себе.

## Граница безопасности

- `productionWrites=false`;
- `classificationMutations=false`;
- `publishAllowedMutations=false`;
- `rawBodiesStored=false`;
- run `33744960785`: `alternateRouteRequestsPerformed=false`;
- run `33745638721`: только обнаруженные routes, `guessedRoutes=false`;
- production generation, manifest, Object Storage, cleanup и публикация не затрагиваются.

## Текущая следующая точка

1. Запущен отдельный conservative `deficit resolution` pass: он повторно проверяет explicit unit-bearing text, exact CARS24 offer price и underlying gallery identities на тех же 8 detail URLs; никаких classification mutations.
2. Для Bobaedream закрывать gallery deficit только при >=5 устойчивых индексов одной offer-bound image series на обоих повторах. Body пока остаётся unresolved.
3. Для DubiCars дедуплицировать render variants по terminal image UUID и сравнивать с offer-bound gallery/image_count.
4. Для CarSwitch/CARS24 отличать доказанное `1.5L/1.8L/5.7L` от exact `engineCc`: маркетинговый литраж сам по себе не превращаем в 1498/1500/5700 cc без точного source field.
5. Если source-bound `powerHp` или exact cc после разрешённых source routes отсутствует, не лечить источник бесконечно: фиксировать `lead_only` либо продолжать только при наличии конкретного доказанного public route.
6. После этого checkpoint обязательно переносится в `roadmap.md`, затем PR и только после зелёного CI — merge.
