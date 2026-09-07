# KB ChaChaCha · access-policy qualification v1

Дата checkpoint: 2026-09-04.

## Зачем этот этап

`kbchachacha_korea_candidate` ранее оставался `research_pending`: публичный marketplace и search facets выглядели полезно для Кореи, но стабильный разрешённый автоматический detail route, price/detail identity и полный exact-field contract не были доказаны.

Перед любым detail/pagination исследованием выполнен отдельный минимальный access-policy probe. Причина: автоматический каталог АвтоЦены не должен строиться на маршруте, который сам источник явно запрещает использовать для scraping/automation.

## Probe boundary

Workflow: `.github/workflows/catalog-source-kbchachacha-access-policy-probe-v1.yml`.

Script: `scripts/catalog-source-kbchachacha-access-policy-probe-v1.mjs`.

Regression: `tests/catalog-source-kbchachacha-access-policy-probe-v1.test.ts`.

Live run `33826631629`, head `5be42c80545baa4ce79e0a7425128322d061fb76` — `success`.

Artifact:

- id `9920244140`;
- digest `sha256:4f4c66bb38a28870c4b8fce53e5cc9313397f148f4a2a52d81574d7254fa265f`.

Жёсткий envelope:

- `requestCount=2`;
- запрос 1: `robots.txt`;
- запрос 2: только registry-declared public search page `https://www.kbchachacha.com/public/search/main.kbc`;
- `detailRequests=0`;
- `paginationRequests=0`;
- `externalScriptRequests=0`;
- raw HTML не сохранялся;
- production/Object Storage/catalog generation writes отсутствовали.

## Live result

- `robots.txt` -> HTTP `200`;
- observed robots policy для registry search route: `allowed=true`, explicit matching disallow отсутствует;
- public search page -> HTTP `200`;
- HTML не был truncated;
- same-origin public `.kbc` links присутствуют, но probe намеренно их не следует;
- в видимом официальном public HTML обнаружен явный запрет несанкционированного scraping/automation;
- `decisionSignal=public_terms_block_automated_collection`.

Важно: robots allowance не трактуется как разрешение на автоматический сбор, когда официальный public page отдельно устанавливает явное ограничение. Поэтому route/detail/pagination discovery после этого сигнала остановлен.

## Классификация

Решение: `class=lead_only`, `publishAllowed=false`.

Разрешённый scope в АвтоЦене на текущем этапе:

- ручной поиск/проверка marketplace;
- reference/lead navigation человеком.

Не разрешено в нашем автоматическом контуре:

- automatic inventory ingestion;
- pagination crawling;
- automated detail crawling;
- публикация карточек из KB ChaChaCha.

Это не оценка качества самого marketplace и не утверждение, что его vehicle data плохие. Это access qualification: текущий публичный путь не подходит для нашего автоматического движка без отдельно разрешённого способа доступа.

## Что может изменить решение

KB ChaChaCha можно переоткрыть на requalification только если появится хотя бы один из вариантов:

1. официально разрешённый API;
2. partner/dealer data feed с правом автоматического использования;
3. письменное разрешение на нужный automated-access scope.

После этого новый probe должен начинаться с разрешённого route и заново доказать offer-level identity, KRW price, body, fuel/powertrain, engineCc, power, mileage и listing-bound gallery. Старое public-page scraping использовать как обход нельзя.

## Safety

На этапе:

- `productionWrites=false`;
- `classificationMutations=false` внутри live probe;
- `publishAllowedMutations=false`;
- `objectStorageWrites=false`;
- `catalogGenerationWrites=false`;
- `rawBodiesStored=false`.

Research ledger после просмотра артефакта обновляется отдельно; production остаётся неизменным.
