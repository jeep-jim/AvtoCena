# АвтоЦена — технический паспорт, архитектура и production roadmap

**Дата snapshot:** 14 августа 2026  
**Проект:** `jeep-jim/AvtoCena`  
**Назначение:** единый документ по архитектуре, каталогам, парсингу, расчётам, storage, quality gates и дальнейшему roadmap.

> При конфликте со старыми каталог-документами этот файл считается более новым описанием системы. Машинно-читаемые правила в коде (`required-catalog-sources.ts`, `offer-quality.ts`, `inventory-quota.ts`, расчётные движки и runtime config) остаются окончательным источником истины.

---

## 1. Что строит АвтоЦена

АвтоЦена — не просто парсер сайтов. Конечная система состоит из двух независимых, но связанных слоёв:

1. **Live Market Catalog** — конкретные реальные объявления и завершённые аукционные лоты.
2. **Vehicle Knowledge Base / Encyclopedia** — постоянные знания о марках, моделях, поколениях и модификациях.

Live catalog отвечает: **какая конкретная машина продаётся сейчас, где, за сколько, какого года, с каким пробегом и какими фото**.

Knowledge Base отвечает: **что это за автомобиль технически — поколение, двигатель, кузов, привод, мощность, 30-минутная мощность, размеры, масса, батарея, комплектация и т.д.**

Главный принцип: **парсер не должен придумывать автомобильные знания, а энциклопедия не должна придумывать факты конкретного объявления**.

---

## 2. Монорепозиторий

- `apps/web` — сайт, PWA, публичный каталог, API, CRM, партнёрка.
- `apps/bot` — Telegram bot.
- `packages/engine` — общие бизнес- и расчётные движки.
- `data` — JSON-данные проекта.
- `scripts` — импорт, recovery, publish, audits, cleanup, knowledge tooling.
- `.github/workflows` — CI, collectors, writers, audits, deployment.
- `docs` — документация.

Проект **JSON-first**. Основная архитектура данных строится вокруг JSON и Object Storage, а не вокруг SQL/PostgreSQL.

---

## 3. Storage

Основной abstraction: `apps/web/lib/data.ts`.

Поддерживаются:

- `local` — локальные JSON;
- `object` — S3-compatible Object Storage.

Production использует Yandex Object Storage через AWS Signature V4.

### Чанки

- общий agreed maximum — до **500 записей на JSON-чанк**;
- live catalog: `CATALOG_CHUNK_SIZE = 500`;
- текущая `vehicle-knowledge` индексирована чанками по **250** записей.

### Stable offer ID

Стабильный ID:

`sha256(sourceId + ":" + sourceOfferId).slice(0, 24)`

Один и тот же listing при повторном запуске получает тот же ID.

### Generations

Каталог хранится поколениями:

`catalog/generations/<generationId>/...`

Текущая generation выбирается маленьким:

`catalog/manifest.json`

Правильная публикация: **сначала полностью записать новую generation и индексы, затем атомарно переключить manifest**.

Public read models включают market projections, brand projections, offer shards, facets, brand summary и compact search projections.

---

## 4. Шесть рынков

| ID | Рынок |
|---|---|
| `korea` | Корея |
| `china` | Китай |
| `japan` | Япония |
| `uae` | ОАЭ |
| `europe` | Европа |
| `georgia` | Грузия |

---

## 5. Канонические источники

Машинно-читаемый registry: `apps/web/lib/catalog/required-catalog-sources.ts`.

### Корея

Обязательное ядро:

- Encar — `encar_direct`
- K Car — `kcar_korea_open`

Дополнительно активно используется:

- KB ChaChaCha — `kbchachacha_korea_open`

### Китай

- Che168 — `autohome_used_china_open`
- Dongchedi — `dongchedi_china_open`
- Guazi — `guazi_china_open`
- Autohome new cars — `autohome_new_china_open`

### Япония

- JPAuc completed auctions — `jpauc_japan_past_open`
- CarVector statistics — `carvector_japan_stat_open`
- Prestige auctions — `prestige_japan_auctions_open`
- Auction Data Search — `auctiondatasearch_japan_open`
- JP Center — `jpcenter_japan_catalog_open`

### ОАЭ

- Dubizzle — `dubizzle_uae_open`
- DubiCars — `dubicars_uae_exact`

### Европа

Обязательное ядро:

- mobile.de — `mobile_de_open`
- AutoScout24 — `autoscout_europe_open`

Дополнительный важный источник: OTOMOTO.

### Грузия

Канонический набор **ТОЛЬКО**:

- MyAuto — `myauto_georgia_list`
- AutoPapa — `autopapa_georgia_open`

Запрещены:

- AUTO.GE
- SS.GE
- MyMarket

## 6. Source Truth Contract

Парсер должен доказать **конкретное объявление**, а не заполнить максимальное количество полей.

Обязательное ядро source facts:

- `sourceId`;
- `sourceOfferId`;
- `sourceUrl`;
- market;
- make;
- model;
- year;
- mileage, если источник реально его отдаёт;
- source price;
- source currency;
- listing-bound gallery;
- timestamps;
- VIN/frame/production date — только если source реально отдаёт.

Характеристики принимаются только из exact/structured поля **этой же машины**.

Если точного значения нет: **оставляем undefined / «уточняется», а не угадываем**.

---

## 7. Fail-closed semantics

Нельзя определять `body / drive / transmission / fuel / mileage / photos` по случайным словам во всём HTML/JSON payload страницы.

Generic `strictSourceDetail` должен fail-closed. Dedicated adapter имеет приоритет.

### Canonical taxonomy

Кузов: `sedan`, `hatchback`, `liftback`, `fastback`, `suv`, `crossover`, `offroad`, `wagon`, `coupe`, `convertible`, `roadster`, `pickup`, `minivan`, `mpv`, `van`.

Привод: `fwd`, `rwd`, `awd`.

Неизвестный raw token не должен публиковаться как будто это нормализованная характеристика.

### Контрольные Korea cases

Нельзя публиковать как SUV/crossover:

- Genesis G80;
- Hyundai Grandeur;
- Hyundai Ioniq 6;
- Kia K9 / K900 / Quoris.

### K Car

`대형차 / 중형차 / 경차` — размерный класс, не кузов.

`4륜 / 사륜 → AWD`, `전륜 → FWD`, `후륜 → RWD`.

### Model matching

Knowledge matcher не имеет права склеивать соседние слова после удаления пробелов.

Реальный найденный баг: `Turbo LT → turbolt → Bolt`. Text fallback теперь требует token/phrase boundaries.

---

## 8. Возрастные правила

### Япония

Rolling window:

`currentYear - 15` → current year.

Только completed/sold auction inventory с положительной финальной ценой.

### Остальные 6 рынков

Жёстко:

`year >= 2020`

Это правило должно выполняться на collector, recovery, retention, preservation, publisher и public output.

---

## 9. Inventory quota

Единственная основная quota:

**до 20 карточек на `market + canonical make + exact model + year`.**

Разные годы одной модели не конкурируют.

Пример:

- Korea / Hyundai / Casper / 2022 → до 20;
- Korea / Hyundai / Casper / 2023 → ещё до 20;
- Korea / Hyundai / Casper / 2024 → ещё до 20.

Нет лимита «20 на модель вообще» и нет лимита моделей на марку.

### Coverage-first

Source target — размер bounded output, а не причина прекратить discovery.

Collector продолжает обход до source/page/time boundary. После discovery `model+year` buckets выбираются round-robin: каждая найденная корзина получает один слот до того, как плотная корзина получает следующий. Внутри одной корзины максимум 20.

---

## 10. Retention и lifecycle

Основное правило:

**3 суток cumulative retention**.

`CATALOG_RETENTION_MS = 3 * 24h`.

Нужно различать:

1. offer retention;
2. physical generation/Object Storage cleanup.

Удалить offer из manifest недостаточно, если старые generation продолжают занимать bucket.

Целевой режим после certification: **один refresh каждого рынка в сутки + накопление максимум 3 суток + автоматический GC старых generations/chunks**.

---

## 11. Фотографии

Фото — отдельный production quality contract.

Правила:

- минимум 5 listing-bound изображений для target production card;
- максимум 30;
- сохранять source order;
- source cover/exterior — приоритет;
- без recommendation/cross-listing;
- без logo/banner/QR/placeholder;
- без бессмысленного upscale thumbnail;
- приборка/двигатель/inspection не должны быть cover, если есть exterior.

### Identity и resolution — разные доказательства

- `photoIdentityVerified` — фото именно этого listing;
- `photoResolutionVerified` — это нормальная rendition, а не thumbnail.

### Европа

**AutoScout24:** старые live карточки могли иметь `250x188.webp`; нужно exact listing-bound HQ (например 1280×960/1920×1080, когда source отдаёт).

**mobile.de:** VIP identity + крупнейший `srcSet`/`mo-1600` candidate.

**OTOMOTO:** только Product/offer-bound gallery текущего ID, без broad recursive scrape.

### Китай

Autohome exact-spec gallery привязана к текущему `specId`; valid product CDN включает `car*.autoimg.cn/cardfs/product/...`.

### Georgia

Cross-listing image contamination запрещён.

### Storage mode

Новый raw collection ориентирован на:

`CATALOG_IMAGE_STORAGE_MODE=source_urls_only`.

Нельзя превращать маленький thumbnail в «HQ» повторным сохранением/растягиванием.

---

## 12. Расчёт цены — два движка

### 12.1. Таможенный движок

`packages/engine/src/calculation/russiaCustoms.ts`

Rule version:

`rf_personal_m1_2026-01-01`.

Входы:

- customs value RUB;
- EUR/RUB;
- engineCc;
- hp/kW;
- ICE kW;
- power30MinKw;
- per-motor 30-min;
- utilizationPowerKw;
- powertrain;
- production date/year;
- fuel.

Возрастные группы:

- до 3 лет;
- 3–5 лет;
- старше 5 лет.

Для ДВС объём используется **без округления**.

Контрольный пример: Kia K9 3.3 GDI = **3342 см³**, не 3300 и не 3000.

Утиль по ДВС разбит по cc bands:

- <=1000;
- 1000–2000;
- 2000–3000;
- 3000–3500;
- >3500.

Для used duty есть отдельные ставки €/см³, включая отдельную границу `>3000`.

### 12.2. Business calculation

`packages/engine/src/calculation/calculateAvtocena.ts`

Итог может включать:

- цену автомобиля;
- обеспечительный платёж;
- комиссию;
- export expenses;
- logistics;
- broker;
- СВХ;
- лабораторию;
- СБКТС;
- ЭПТС;
- доставку по РФ;
- customs;
- прочие fixed expenses;
- percentage expenses;
- exchange reserve;
- manual adjustment.

Обеспечительный платёж — часть цены машины, а не дополнительная стоимость сверху.

---

## 13. Customs value и currency

`customsValueRub = sourcePriceRub + transportToBorderRub`.

Transport до границы включается только если реально определён.

Если нет курса валюты, карточка не получает выдуманный total: `calculationStatus = needs_currency_rate`.

---

## 14. Powertrain safety

Канонические виды:

- `combustion`;
- `electric`;
- `series_hybrid`;
- `other_hybrid`;
- `unknown`.

### Pure EV

У pure EV `engineCc` должен быть пустым.

Любой положительный cc у явно electric offer удаляется safety-layer’ом.

Реальные пойманные ошибки: Casper Electric и Kia Ray EV с ложными `3000 cc`.

Hybrid это правило не применяет автоматически, потому что у него реально есть ДВС.

---

## 15. Мощность и 30-minute power

Нельзя подменять 30-minute power пиковой мощностью.

`power30MinKw` принимается только из доверенного документа/источника: type approval, homologation, CoC, ОТТС, СБКТС, ЗОЕТС, ЭПТС, официальный registry/manufacturer document.

Для pure EV / series hybrid нужен documented 30-minute/utilization power.

Для other hybrid нужны ICE kW + documented 30-minute electric motor power.

### preliminary_power_pending

Если отсутствует power value, влияющий на утиль/акциз, валидная карточка не обязана исчезать.

Она может публиковаться как `preliminary_power_pending`:

- известные платежи считаются;
- неизвестный утиль не считается нулём;
- power-dependent components исключаются;
- цена помечается preliminary;
- финальную сумму подтверждает менеджер.

То же теперь допускается для нормальных ДВС, если source не отдаёт horsepower, но остальные обязательные данные валидны.

---

## 16. Источники power data

Контролируемая цепочка:

1. source exact power;
2. exact vehicle-knowledge variant;
3. certified power reference;
4. power knowledge;
5. preliminary mode.

Model-wide representative horsepower **не является достаточным доказательством** для точного customs расчёта конкретного listing.

---

## 17. Текущая Vehicle Knowledge

`data/catalog/vehicle-knowledge/`

Snapshot 06.08.2026:

- models: **4 899**;
- variants: **15 735**.

Model умеет хранить canonical make/model, aliases, body types, countries/regions, production years, representative power.

Variant умеет хранить generation, production range, engine cc, fuel, transmission, drive, body, hp/kW, ICE power, 30-minute power, per-motor power, utilization power и provenance.

Knowledge не имеет права переписывать source identity по слабому совпадению.

---

## 18. Encyclopedia V2

Изолированная будущая база:

`data/catalog/vehicle-encyclopedia-v2/`

Целевой coverage: модели/поколения/варианты, производство которых пересекается с **2015 → настоящее время**.

Структура:

`brand → model → generation → variant`

Каждый факт — с provenance.

Два потребителя:

1. **SEO** — бренд/модель/поколение/вариант/характеристики/current offers.
2. **Enrichment/Calculation** — безопасное дополнение proven live listing.

Codex strategy:

`source → research → normalization → evidence → JSON → validation → review → runtime compiler`.

Pilot brands: Toyota, BMW, Mercedes-Benz, Hyundai, Kia, Volkswagen, BYD, Geely, Honda, Nissan.

30-minute power никогда не рассчитывается из peak.

---

## 19. Collection pipeline

```text
SOURCE
  ↓
fetchPage / API / HTML
  ↓
sourceOfferId + sourceUrl
  ↓
normalizeOffer
  ↓
year / source / vehicle gates
  ↓
exact detail identity
  ↓
listing-bound gallery
  ↓
semantic fail-closed normalization
  ↓
powertrain safety
  ↓
optional exact variant / certified power
  ↓
currency conversion
  ↓
RF customs
  ↓
market business calculation
  ↓
quality gates
  ↓
model+year quota
  ↓
3-day retention merge
  ↓
dry-run
  ↓
atomic generation publish
  ↓
facets / projections / indexes
  ↓
post-publish all-6 audit
```

---

## 20. Publication safety

Главное правило: **никогда не запускать два catalog writer одновременно**.

Перед write:

1. проверить active/queued GitHub Actions;
2. определить writers;
3. не прерывать active writer;
4. прочитать current all-market state;
5. собрать target market;
6. сохранить остальные 6 рынков;
7. dry-run;
8. сверить counts и quality;
9. atomic publish;
10. post-publish all-6 audit.

Нельзя передавать Georgia-only/Korea-only массив как whole generation, если publisher строит общий каталог. Правильный путь — заменить target market внутри полного all-market массива.

Collectors могут работать параллельно read-only. Writers — строго последовательно через shared concurrency lock, `cancel-in-progress: false`.

---

## 21. Production workflows

Основной raw orchestrator в проекте:

`.github/workflows/catalog-v4-all-markets-30k.yml`

Reusable market flow:

`.github/workflows/catalog-v4-market-30k-reusable.yml`

Raw collection использует source URLs, min 5 / max 30 photos, 3-day retention и knowledge-disabled collection, чтобы не портить source identity.

Issue #241 сейчас использует временные recovery/proof/audit workflows для стабилизации. После certification временный workflow zoo должен быть сокращён.

Отдельный workflow `catalog-certified-power-apply.yml` применяет reviewed/certified power references и пересчитывает точно совпавшие electrified cards. Он тоже является writer и не должен пересекаться с другими catalog writers.

---

## 22. Целевой ежедневный режим

После certification:

**1 refresh каждого рынка в сутки.**

Каждый рынок:

`collect → validate → dry-run → shared writer → all-6 audit`.

Накопление — максимум 3 суток. Затем automatic offer retention + physical old-generation GC.

---

## 23. Business liquidity

Нельзя фальсифицировать customs ради красивой цены.

Если машина экономически бессмысленна, применяется explainable ranking/rejection по возрасту, power, total/source ratio, absolute total и market/model class.

Приоритет — более свежие и ликвидные автомобили. EV/PHEV не должны ошибочно фильтроваться ICE horsepower heuristic’ом.

---

## 24. Quality gates

Production PASS требует:

### Identity

- stable sourceOfferId;
- expected source host;
- meaningful make/model;
- exact detail belongs to same offer;
- source price belongs to same offer.

### Age

- Japan rolling 15 years;
- other markets >=2020.

### Vehicle

- no motorcycle/machinery/random commercial junk;
- no impossible semantic body classification.

### Photo

- listing-bound;
- no cross-listing;
- no placeholder;
- target production card >=5;
- <=30.

### Price

- source price >0;
- currency exists;
- calculated/preliminary total >0;
- unknown power-dependent fee never becomes zero.

### Quota

`market + make + exact model + year <=20`.

### Localization

Public UI не должен показывать сырой CJK/Kana/Hangul. Известное переводится, неизвестное скрывается/помечается как уточняемое.

---

## 25. Search, filters и performance

Compact projections/facets должны обслуживать фильтры по market, make, model, year, body, fuel, transmission, drive, budget, power, mileage, engine cc.

Оставшиеся задачи:

- compact projection latency;
- filter correctness;
- URL params ↔ client/server state;
- убрать zero flash;
- убрать долгий blocking loader;
- light theme contrast;
- исключить `Signal: killed` на тяжёлых market pages.

---

## 26. CRM / CPA / Leads

JSON-first контур также включает clients, leads, feed, deals, partners, CPA networks/payouts, contracts, market settings и site-business settings.

Есть CRM, partner cabinet, referral/click attribution (`ref`, `click_id`, `sub1–sub5`, UTM), заявки из каталога, менеджеры, статусы, комментарии и CPA API.

После Encyclopedia V2 эти системы должны использовать общую canonical vehicle identity.

---

## 27. Definition of production-ready parser machine

Парсерная часть считается законченной после полного fresh certification cycle по всем 6 рынкам.

Для каждого рынка:

- age violations = 0;
- banned sources = 0;
- nonVehicle = 0;
- max exact model+year <=20;
- duplicate stable IDs = 0;
- cross-listing photos = 0;
- placeholders = 0;
- target cards below 5 photos = 0;
- impossible EV engineCc = 0;
- malformed semantic tokens = 0;
- broken source prices = 0;
- detail identity mismatch = 0;
- manifest/read models generation consistent;
- market refresh не уничтожает другие рынки;
- filters smoke = PASS;
- latency/memory smoke = PASS.

---

## 28. Roadmap до заморозки парсеров

### Phase A — Korea finish

- Encar body fail-closed;
- KB Malibu identity;
- K Car taxonomy;
- EV engineCc safety;
- K9 3342 cc;
- 5+ image contract;
- fresh Encar + K Car + KB rebuild;
- semantic/photo audit;
- atomic publish;
- live audit.

### Phase B — Europe

- AutoScout HQ exact gallery;
- mobile.de resolution verification;
- OTOMOTO identity-bound gallery;
- real width/height/bytes audit;
- refresh legacy low-res cards.

### Phase C — UAE

- Dubizzle label-bound semantics;
- exact gallery;
- DubiCars exact identity;
- year gate;
- photo quality;
- no marketing-year promotion.

### Phase D — Georgia

- only MyAuto + AutoPapa;
- exact identity/price;
- >=2020;
- HQ galleries;
- no cross-listing;
- clean corrupted legacy rows.

### Phase E — China

- exact product/spec identity;
- Autohome/Che168/Guazi/Dongchedi;
- full-res gallery;
- localization;
- no CJK leakage;
- correct price/mileage.

### Phase G — Japan

- sold/completed only;
- positive final price;
- exact lot identity;
- >=5 lot photos;
- rolling 15-year window;
- scale to thousands;
- no loss between source → calculation → publish.

### Phase H — all-6 certification

Один полный fresh cycle.

### Phase I — daily 3-day machine

После PASS:

- daily refresh;
- 3-day cumulative inventory;
- automatic old offer deletion;
- old generation GC;
- alerts only on meaningful degradation.

---

## 29. После парсеров — Encyclopedia V2

После production certification парсеры становятся инфраструктурой.

Дальше основной focus:

1. mass Codex research;
2. runtime knowledge compiler;
3. exact calculations;
4. brand/model/generation SEO pages;
5. canonical catalog hierarchy;
6. comparisons;
7. budget recommendations по реальному live inventory.

Финальная идея:

> **АвтоЦена = реальный мировой live-каталог + собственная автомобильная энциклопедия + точный расчёт импорта.**

---

## 30. Главные инженерные принципы

1. Source truth first.
2. Unknown is better than wrong.
3. No cross-listing data.
4. No guessed customs power.
5. No peak → 30min substitution.
6. No rounded engine displacement for customs.
7. No competition between years of one model.
8. No writer concurrency.
9. Atomic all-market state.
10. Provenance for important fields.
11. Deterministic failure is diagnosed, not blindly retried.
12. Green CI without real data quality is not success.
13. Live catalog and encyclopedia are separate domains.
14. Knowledge may enrich a proven listing but must not rewrite weak source identity by guess.
15. SEO is built on verified knowledge, not generated hallucinated specs.

---

## 31. Key code map

### Catalog

`apps/web/lib/catalog/`

Ключевые модули:

- `importer.ts` — source registry / wrappers;
- `storage.ts` — generations, projections, stable IDs;
- `offer-quality.ts` — quality gates;
- `inventory-quota.ts` — 20/model/year + coverage-first;
- `spec-normalization.ts` — normalization;
- `powertrain-safety.ts` — impossible powertrain field safety;
- `customs-pricing.ts` — catalog → customs + business pricing;
- `vehicle-knowledge.ts` — current knowledge matching;
- `power-reference.ts` — certified power;
- `power-knowledge.ts` — power matching;
- `image-quality.ts` — image quality/ranking;
- `runtime-config.ts` — markets/chunks/retention;
- `required-catalog-sources.ts` — mandatory source registry.

### Calculation engine

`packages/engine/src/calculation/`

- `russiaCustoms.ts`
- `calculateAvtocena.ts`

### Knowledge

Current:

`data/catalog/vehicle-knowledge/`

Future:

`data/catalog/vehicle-encyclopedia-v2/`

### Scripts

`scripts/` содержит collectors, recovery, publish, certified power, storage cleanup, knowledge sync/audit, reindex и catalog audits.

---

## 32. Что нельзя делать

- не возвращать AUTO.GE / SS.GE / MyMarket в Georgia;
- не публиковать market-only array как whole generation;
- не запускать writer поверх writer;
- не округлять 3342 → 3000;
- не давать pure EV `engineCc`;
- не писать G80/K9/Grandeur/Ioniq 6 как SUV;
- не считать 30-minute из peak;
- не использовать recommendation photos;
- не использовать thumbnail, если есть full-size;
- не терять старшие годы из-за source target;
- не придумывать модель из weak text match;
- не считать неизвестный утиль нулём;
- не уничтожать рабочий рынок из-за временного source blocker;
- не считать «workflow зелёный» равным «production ready».

---

## 33. Итоговая схема

```text
7 MARKET SOURCES
        ↓
SOURCE-TRUTH COLLECTORS
        ↓
IDENTITY + HQ PHOTO VERIFICATION
        ↓
CANONICAL NORMALIZATION
        ↓
LIVE OFFER STORE (3 DAYS)
        ↓
VEHICLE KNOWLEDGE MATCH
        ↓
CERTIFIED POWER / 30-MIN REFERENCES
        ↓
RF CUSTOMS ENGINE
        ↓
MARKET BUSINESS ENGINE
        ↓
ATOMIC JSON CATALOG
        ↓
SEARCH / FILTER / SEO / CRM / CPA
        ↑
VEHICLE ENCYCLOPEDIA V2
```

Парсер добывает доказанный факт продажи.  
Энциклопедия знает автомобиль.  
Расчётчик знает стоимость ввоза.  
Каталог связывает всё это в один продукт.
