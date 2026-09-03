# Catalog source deficit reconnaissance v1

Дата старта: 2026-09-03.

## Точка, с которой продолжаем

PR #826 (`3826f80b04371ba8c4c0b8a3321292fa93bf5db2`) влит в `main`. Read-only source-bound field audit четырёх сильнейших кандидатов завершён зелёным checkpoint run `33731675254`, artifact `9884112823`, digest `sha256:4dc1b6fa50e7607676d5723b9465dc75cb98f5be6f4c345ad56bd980bd7358f8`.

Ни один кандидат не получил `exact_catalog`: все остаются `research_pending`, `publishAllowed=false`.

Незакрытые доказательства:

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

На этом проходе alternate routes только обнаруживаются, но автоматически не запрашиваются. После просмотра evidence разрешённые публичные маршруты добавляются точечно. Это не позволяет случайно начать обход challenge/login/robots или превратить исследовательский crawler в production parser.

## Граница безопасности

- `productionWrites=false`;
- `classificationMutations=false`;
- `publishAllowedMutations=false`;
- `rawBodiesStored=false`;
- `alternateRouteRequestsPerformed=false`;
- production generation, manifest, Object Storage, cleanup и публикация не затрагиваются.

## Следующее решение

После зелёного recon artifact вручную проверить найденные route/key/gallery/body evidence. Только если конкретный источник даёт недостающее значение с доказанной привязкой к offer, делать точечный read-only alternate-route probe. Если разрешённого source-bound доказательства нет, источник переводить не в `exact_catalog`, а в `lead_only` или `rejected` по контракту.
