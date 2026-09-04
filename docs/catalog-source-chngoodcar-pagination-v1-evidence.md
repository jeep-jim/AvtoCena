# Guangdong Good Car / CarsList pagination qualification v1

Дата финального checkpoint: 2026-09-04.

## Контекст

Этот этап продолжает `roadmap.md` 40.27. Источник `chngoodcar_china_candidate` уже имел source-level `class=exact_catalog` только для ограниченного passenger ICE exact-scope, но `publishAllowed=false` и не входил в production China allowlist. Цель этого этапа — не публиковать источник, а доказать реальную массовую discovery/pagination схему и проверить exact-gates на распределённой по каталогу выборке.

## Реальный CarsList contract

Пагинация не угадывается через `?page=2` и не строится по неподтверждённому API. Read-only route probe восстановил реальный контракт самого сайта:

- bootstrap: `GET https://www.chngoodcar.com/Home/CarsList`;
- из bootstrap извлекаются anti-forgery token и cookie;
- visible page contract обязан содержать `价格(US $)`;
- rows получаются `POST https://www.chngoodcar.com/Car/SearchCarList`;
- POST body повторяет source-declared no-filter request: `Hot=false`, `DefaultSort=1`, `PriceSort=0`, `MileageSort=0`, `YearSort=0`, `pageindex`, `pagesize=15`;
- row identity принимает только numeric `Id`, exact title, positive Price, `Currency=USD`, exact `YYYY-MM` ProductionDate и non-negative Mileage;
- non-USD и malformed identity rows отклоняются с явной причиной, а не интерпретируются.

Основные файлы:

- `apps/web/lib/catalog/chngoodcar-carslist.ts`;
- `apps/web/lib/catalog/chngoodcar-paginated-exact-source.ts`;
- `apps/web/lib/catalog/chngoodcar-reviewed-exact-source.ts`;
- `apps/web/lib/catalog/chngoodcar-price-review.ts`;
- `apps/web/lib/catalog/chngoodcar-reference-conflicts.ts`;
- `scripts/catalog-source-chngoodcar-list-exhaustion-v2.ts`.

## Exact join boundary

CarsList row связывается только с `/Home/Cars?id=<same Id>`. Для automatic exact passenger ICE acceptance обязательны:

- exact list/detail title parity;
- exact list/detail source-price parity;
- exact list/detail production-date parity;
- exact list/detail mileage parity, включая decimal mileage;
- explicit USD contract;
- offer-bound exact engine displacement in ml;
- offer-bound exact power in kW;
- combustion fuel without identity-bound electrified marker;
- passenger body;
- listing-bound gallery >=5;
- deterministic supported make/model identity;
- отсутствие independently verified exact-version source conflict;
- отсутствие manual-price-review condition.

List fuel/body/power hints не заменяют detail evidence. External references никогда не заполняют и не исправляют source fields: они используются только для fail-closed rejection при доказанном exact-version конфликте.

## Full CarsList exhaustion

Финальный run: `33824559065`.

- head: `e817b82a4bd7f94596ebb0adcdb492ffb52c2590`;
- conclusion: `success`;
- artifact: `9919508699`;
- digest: `sha256:db9875b88c09de5b3abbb6217a66a4428c937b00476df4229c8336dc7a9c6a71`;
- `initialTotal=1434`;
- `expectedPageCount=96`;
- `requestedPageCount=96`;
- source total: min `1434`, max `1434`, drift `0`;
- `uniqueRawIds=1434`;
- duplicate raw IDs: `0`;
- `uniqueIdentityIds=1426`;
- duplicate accepted identity IDs: `0`;
- rejected list identities: `8`, все `non_usd_currency`;
- stratified detail pages: `1, 20, 39, 58, 77, 96`;
- accepted exact passenger ICE in stratified sample: `24`;
- accepted makes: `现代`, `马自达`, `大众`, `比亚迪`, `宝马`, `奥迪`, `丰田`, `日产`, `长安`, `起亚`;
- rejected passenger ICE in stratified sample: `32`;
- blocked non-passenger: `1`;
- blocked manual-price-review: `1`;
- blocked verified reference conflicts observed in this stratified sample: `4`;
- `failures=[]`.

Все шесть sampled detail pages завершили health check без network errors. Последняя list page содержит 9 raw rows; detail parser их не повысил до exact, что является fail-closed поведением, а не поводом дополнять недостающие поля inference.

## Manual-price-review gate

Первый полный exhaustion run `33777919699` намеренно завершился failure после того, как exact list/detail parity пропустила современную Mazda CX-5 с source price `100 USD`. Цена не была заменена, пересчитана или исправлена по рыночной оценке.

После этого добавлен отдельный gate: современный offer (2020+) с положительной source USD price ниже `2000 USD` сохраняет исходную цену как evidence, но не допускается автоматически и уходит в manual review.

В финальном run заблокирована одна такая строка:

- Mazda CX-5, sourceOfferId `2049030561644670976`;
- source year `2023`;
- source price `100 USD`;
- reason `modern_offer_in_source_under_2000_usd_band`.

## Exact-version source-conflict ledger

Текущий ledger содержит пять narrow reject-only правил. Ни одно правило не переписывает source data.

1. Toyota Prado 2016 3.5 AT TX: Good Car `柴油`, exact Autohome spec 23948 `汽油`.
2. BYD Song MAX 2018 1.5T 自动智联旗舰型 6座: Good Car `SUV`, exact Autohome spec 33704 `MPV`.
3. Toyota Camry 2012 尊瑞 2.5HG 豪华版: Good Car `汽油`, exact Autohome spec 12931 hybrid.
4. Geely Xingyue 2019 300T 探星者: Good Car `汽油`, exact Autohome spec 39287 `汽油+48V轻混系统`, matching 1477 cc / 130 kW identity.
5. Volkswagen 朗行 2017 180TSI DSG舒适版: Good Car `轿车`, exact Autohome spec 29388 `两厢车`, matching 1.2T / 81 kW identity.

В финальной стратифицированной выборке реально встретились и были заблокированы четыре конфликта: Song MAX (page 20), Xingyue (page 39), Camry (page 58), Langxing (page 77). Prado не попал в текущие шесть sampled pages, но его regression rule остаётся активным и тестируется.

После добавления последних двух правил reference-conflict regression suite = `7/7` pass. Price-review, identity normalization, CarsList contract, paginated exact tests и project typecheck также прошли до полного exhaustion.

## Дополнительный five-page confirmation

Run `33824474523` на head с финальными reference tests завершился `success`:

- 5 pages;
- source total `1434` стабилен;
- 75 raw rows / 73 valid identity rows;
- 50 joined details;
- accepted `15`;
- identity-electrified rows blocked `3`;
- verified reference conflict observed and blocked `1`;
- failures `[]`;
- artifact `9919467819`;
- digest `sha256:703fd9c5495150e726a1dd33a31ba68ee8a3db0acf8f8eb5765f397fff9647ab`.

## Safety boundary

На всём этапе:

- `productionWrites=false`;
- `classificationMutations=false`;
- `publishAllowedMutations=false`;
- `objectStorageWrites=false`;
- `catalogGenerationWrites=false`;
- `productionAllowlisted=false`;
- source `publishAllowed=false`;
- public China generation, manifest, stored production catalog, cleanup и publication не менялись.

## Вердикт и следующая точка

Good Car теперь доказан как источник с реальной server-side pagination и полным 1434-row public CarsList inventory на момент run, а не как homepage canary. Это усиливает source-level `exact_catalog` qualification, но не означает, что все 1434 rows готовы к публикации: offer-level exact gate остаётся обязательным.

Следующий безопасный шаг после merge этого research-пакета — оставить Good Car вне production allowlist и продолжить квалификацию остальных источников/рынков. Production promotion Good Car должен быть отдельным решением после общего six-market no-write readiness, а не следствием этого source-only run.