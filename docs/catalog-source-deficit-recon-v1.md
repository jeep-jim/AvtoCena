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
   - body contexts текущей detail-страницы содержат в основном навигационные/общие слова и сами по себе **не доказывают canonical body**;
   - следующий точечный шаг: read-only probe двух найденных spec routes с robots check и проверкой привязки `class_no/year_no` к offer.

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

## Граница безопасности

- `productionWrites=false`;
- `classificationMutations=false`;
- `publishAllowedMutations=false`;
- `rawBodiesStored=false`;
- в run `33744960785` `alternateRouteRequestsPerformed=false`;
- production generation, manifest, Object Storage, cleanup и публикация не затрагиваются.

## Следующая точка продолжения

1. Консервативно нормализовать gallery evidence Bobaedream/DubiCars и закрывать gallery deficit только при >=5 устойчивых listing-bound underlying images.
2. Выполнить robots-aware read-only probe только двух **уже обнаруженных** Bobaedream spec routes; никаких guessed API URLs.
3. На исходных detail HTML отдельно проверить явные unit-bearing patterns (`1.5L`, `5.7L`, `1.8L`, `cc`) и offer-hero price contexts для CarSwitch/CARS24, не повышая общие модельные страницы или диапазоны до exact.
4. Если source-bound `powerHp` для CarSwitch/CARS24 и ICE DubiCars отсутствует, не подменять его собственной энциклопедией: кандидат остаётся `research_pending` до итогового решения `lead_only/rejected` либо до нахождения разрешённого точного source route.
5. После завершения этого блока записать checkpoint в `roadmap.md` и только затем готовить PR.
