# BE FORWARD Japan — source qualification v1

Дата: 2026-09-04

Источник: `beforward_japan_candidate`

Рабочая ветка: `feat/beforward-japan-qualification-v1-20260904`

## Вердикт

`lead_only`, `publishAllowed=false`.

BE FORWARD имеет реальный публичный fixed-price stocklist и может использоваться как источник lead/search evidence. На публичной выдаче source-bound видны `Ref No.`, цена в USD, год/месяц, пробег, объём двигателя в `cc`, топливо, трансмиссия и Japan location.

При этом текущий разрешённый server-side маршрут не позволяет доказать полный exact-card contract: stocklist и четыре source-declared detail URL на GitHub runner возвращают HTTP `202` JavaScript robot-verification shell. Мы не обходим этот check. Поэтому body, power и listing-bound gallery, а также repeatable detail parity не продвигаются до exact.

## Safety boundary

На всём этапе:

- `productionWrites=false`;
- `classificationMutations=false` во время probe;
- `publishAllowedMutations=false` во время probe;
- `objectStorageWrites=false`;
- `catalogGenerationWrites=false`;
- `rawBodiesStored=false`;
- `guessedRoutes=false`;
- production China/Japan registry и public generation не менялись;
- challenge/robot verification не обходился.

## Public source contract

Публичный BE FORWARD `/stocklist` 2026-09-04 отдавал source-declared vehicle URLs формата:

`/{make}/{model}/{refNo}/id/{numericId}/`

И list-side поля конкретного предложения: `Ref No.`, USD price, year/month, mileage km, engine cc, transmission, location, model code, fuel, drive и другие stock attributes.

Для фиксированного detail-аудита сохранены четыре source-declared примера:

1. Nissan March — `CE621935` — `$2,120`, `2017/7`, `81,267 km`, `1,190 cc`, Petrol, Nagoya — `https://www.beforward.jp/nissan/march/ce621935/id/16508049/`.
2. Toyota Vitz — `CE612705` — `$2,320`, `2012/7`, `123,609 km`, `1,320 cc`, Petrol, Yokohama — `https://www.beforward.jp/toyota/vitz/ce612705/id/16508135/`.
3. Honda Fit — `CE612708` — `$2,390`, `2014/3`, `144,925 km`, `1,310 cc`, Petrol, Yokohama — `https://www.beforward.jp/honda/fit/ce612708/id/16508165/`.
4. Toyota Crown — `CE621869` — `$2,590`, `2009/9`, `102,411 km`, `2,490 cc`, Petrol, Nagoya — `https://www.beforward.jp/toyota/crown/ce621869/id/16507885/`.

Эти значения используются только как list-side source evidence и не превращаются в опубликованные карточки.

## Run 33834601306 — dependency-free stocklist probe

Статус: `success`.

Artifact: `9922848051`.

Digest: `sha256:a5a6cbbd8dde9c1941be2fe13a03fd185e0e47bf8c227b486a16d09ed8554676`.

GitHub runner получил `/stocklist` как HTTP `202`, `text/html`, около `2004` bytes. Из этого shell не извлечено detail links (`discoveredCandidateCount=0`). Этот ноль **не интерпретируется как ноль автомобилей у BE FORWARD** и не используется как catalog-count evidence.

## Run 33834734630 — four fixed source-declared detail URLs

Статус: `success`.

Artifact: `9922893163`.

Digest: `sha256:b50578ec98544fabe17f10539b11a67e9ee54b20bea34ae0ddc3991a234d4bfe`.

Все четыре URL были запрошены дважды, robots-aware. `robots.txt` был доступен и не запрещал эти URL, но каждое обращение вернуло HTTP `202` shell с сообщением, что для проверки «not a robot» требуется JavaScript.

Результат:

- `stableReachableCount=0`;
- `exactReadyCount=0`;
- deficits на всех 4/4: identity/detail parity, price/detail parity, year/detail parity, mileage/detail parity, engineCc/detail parity, fuel detail, body, power и gallery;
- server-side bypass не предпринимался.

## Run 33834395739 — full branch contract

Статус: `success`.

Этот workflow прошёл `npm ci`, BE FORWARD regression contract, project typecheck, no-write qualification и no-write envelope. Его generic stocklist discovery также не доказал detail inventory из-за HTTP `202` shell; поэтому green CI не повышает источник до `exact_catalog`.

## Checkpoint writer failure

Первый durable-writer run `33834993597`, head `49bd380a73b832631079536b340a20f6307db051`, job `persist`, дошёл до шага `Commit durable ledger and roadmap checkpoint` и упал на `git diff --cached --check`: `roadmap.md:1564: new blank line at EOF`.

Причина — генератор `40.30` добавлял лишний newline поверх уже завершённого newline в checkpoint text. Source probes, классификация и mutation-boundary проверки в этом run были `success`; push не выполнялся.

Исправление: `appendRoadmapCheckpoint` теперь оставляет ровно один EOF newline; regression-test явно запрещает `\n\n` на EOF. Исправляющие коммиты: `489dc1c55da08db48b08019f420de456ef90c5c2` и `97b12e90bc28e98202361a88124cf86ff7ab7203`.

Retry run `33835096407`, head `15b2844a4ab6d2e1638a2a56662acfe660989db1` — `success`; generated ledger + roadmap checkpoint закоммичены bot-коммитом `7ebc5a280252f1941e580f13d154bdf60e634ff3`.

## Классификационное решение

`lead_only` — потому что источник публично и offer-bound показывает полезный list-side stock contract, но полный exact-card contract через разрешённый server-side маршрут не доказан.

Это **не** `rejected`: публичный stocklist является реальным vehicle lead feed.

Это **не** `exact_catalog`: отсутствует доказанный repeatable detail layer для body/power/gallery и полного offer-level parity.

`publishAllowed` остаётся `false`.

## Следующий шаг

Не пытаться обходить BE FORWARD JavaScript robot verification. Перейти к следующему Japan fixed-price кандидату — `sbtjapan_japan_candidate` — с тем же read-only contract. К BE FORWARD возвращаться только если появится разрешённый публичный/partner route, который отдаёт полный detail evidence без обхода защиты.
