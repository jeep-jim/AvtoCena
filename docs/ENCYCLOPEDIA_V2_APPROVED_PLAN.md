# АвтоЦена — Encyclopedia V2 · утверждённый план

**Статус:** APPROVED  
**Дата утверждения:** 2026-08-14  
**Команда продолжения:** `Энциклопедия`

Если в новом чате/сессии пользователь пишет **«Энциклопедия»**, это означает: продолжать реализацию этого документа без повторного проектирования базовой архитектуры, если пользователь явно не изменил требования.

---

## 1. Цель

Построить для АвтоЦены постоянную автомобильную энциклопедию уровня «автомобильной Википедии», которая:

1. знает марки, модели, поколения, рестайлинги и модификации;
2. хранит полные технические характеристики;
3. безопасно дополняет live-объявления;
4. даёт точные входные данные существующему расчётному движку;
5. создаёт большой SEO-граф страниц;
6. используется в поиске АвтоЦены и AI-discovery;
7. содержит качественную визуальную обложку модели/поколения;
8. никогда не выдумывает отсутствующие характеристики.

Live Market Catalog и Encyclopedia — разные слои.

**Live Market Catalog отвечает:** что реально продаётся, где, когда и за сколько.  
**Encyclopedia отвечает:** что это за автомобиль технически.

Расчётный движок таможни/утиля/стоимости не перестраивается: Encyclopedia поставляет ему правильные входные данные.

---

## 2. Каноническая иерархия

```text
Brand
  → Model
    → Generation
      → Facelift / Restyling
        → Variant / Modification
          → Technical Specs
          → Media
          → Provenance
```

Нельзя смешивать:

- модель с поколением;
- модель с комплектацией;
- модель с обозначением привода/технологии;
- дилерский/рыночный alias с канонической моделью;
- случайный token из объявления с канонической сущностью.

Пример:

```text
Audi
  → Q2
    → I generation
      → 2016–2020
      → I facelift
        → 2020–...
          → 30 TFSI
          → 35 TFSI
          → 35 TDI quattro
```

---

## 3. Источники — базовая стратегия

Не строить Encyclopedia на одном коммерческом автомобильном сайте.

Приоритетная система источников:

### Global identity / graph / media
- Wikidata
- Wikimedia Commons

Назначение: марки, модели, связи, aliases, страны, годы, canonical media и лицензирование изображений.

### USA / Canada
- NHTSA vPIC
- Transport Canada vehicle specifications
- DOE / AFDC
- EPA when useful

Назначение: официальные make/model/year, VIN-oriented identity, размеры, силовые установки, EV/PHEV range, battery/charging/performance facts.

### Europe
- European Environment Agency (EEA)
- homologation / official European registries when available

Назначение: type / variant / version, engine capacity, engine power, mass, fuel, WLTP, electric consumption, electric range and homologation facts.

### China
- MIIT official vehicle registry/public announcements

Назначение: модели, технические параметры, батареи, motor model, rated/nominal power, peak power, PHEV/BEV facts, official images where legally reusable/appropriate.

### Last-resort enrichment
Если конкретного факта нет в крупных open/official sources:
- официальный производитель;
- официальный homologation/type-approval документ;
- проверенный дополнительный источник с понятным provenance.

Коммерческий агрегатор не становится единственным источником истины для критичного расчётного поля.

---

## 4. Сбор данных

Работа гибридная:

### Codex / code
Используется для:
- массового ingestion;
- обхода API/datasets;
- нормализации;
- aliases;
- canonical matching;
- дедупликации;
- generation/variant linking;
- chunking;
- validation;
- QA reports;
- runtime compiler;
- SEO projections.

### Мы вручную
Определяем:
- contracts;
- обязательные поля;
- source priority;
- конфликтные случаи;
- canonical naming;
- правила поколений/рестайлингов;
- reviewed corrections;
- высокорисковые поля расчёта.

Стратегия:

```text
source
→ research
→ normalization
→ canonical resolution
→ evidence/provenance
→ JSON
→ validation
→ review
→ runtime compiler
```

---

## 5. Этапы наполнения

Не пытаться собрать всю глубину за один проход.

### Pass 1 — глобальный каталог
- brands;
- models;
- aliases;
- production years;
- countries;
- basic body types;
- one canonical cover image.

### Pass 2 — generations
- generation;
- generation aliases;
- productionFrom / productionTo;
- facelift/restyling;
- body variants;
- generation media.

### Pass 3 — variants / engines
- trim / modification;
- engine family/code;
- engine cc;
- fuel;
- transmission;
- drive;
- power hp/kW;
- torque;
- body.

### Pass 4 — deep specifications
- dimensions;
- wheelbase;
- ground clearance;
- curb/gross weight;
- seats;
- trunk;
- fuel tank;
- acceleration;
- top speed;
- consumption;
- emissions;
- tyres/wheels when reliable;
- other stable technical fields.

### Pass 5 — EV/PHEV specialization
- motor count;
- motor locations;
- peak motor power;
- rated/nominal power;
- documented 30-minute power;
- utilization power;
- ICE power for hybrids;
- battery chemistry;
- gross/usable capacity;
- WLTP/EPA/CLTC range as separate fields;
- AC charging;
- DC charging;
- connector;
- 10–80% charge time when official/reliable;
- energy consumption.

---

## 6. Critical power rule

`power30MinKw` НИКОГДА не рассчитывается из peak power.

30-minute / utilization power принимается только из документированного доверенного источника:
- official registry;
- homologation/type approval;
- CoC;
- ОТТС/ЗОЕТС/СБКТС/ЭПТС;
- manufacturer official document where applicable.

Если значения нет — поле отсутствует / статус требует знания. Оно не заменяется догадкой.

---

## 7. Provenance

Каждый критичный факт должен иметь происхождение.

Для высокорисковых полей provenance желательно хранить на уровне самого поля.

Пример логики:

```json
{
  "power30MinKw": {
    "value": 55,
    "sourceType": "official_registry",
    "sourceId": "miit",
    "sourceUrl": "...",
    "verifiedAt": "2026-08-14",
    "confidence": "official"
  }
}
```

Нужно различать минимум:
- official;
- registry;
- manufacturer;
- homologation;
- high-confidence curated;
- secondary/reference.

Расчётно-критичные поля не должны автоматически брать слабый secondary источник при наличии конфликта.

---

## 8. JSON / storage

Архитектура остаётся JSON-first.

Целевая база: `data/catalog/vehicle-encyclopedia-v2/`.

Использовать существующие файлы/структуры, если они подходят. Новые сущности создавать только когда структура V2 требует их явно.

JSON chunking — согласно правилам проекта; большой список делить, когда файл приближается к agreed chunk limit.

Существующий `vehicle-knowledge` используется как мост/legacy runtime, пока V2 не готова заменить его безопасно.

---

## 9. Media / cover images

В Encyclopedia обязательно иметь визуальный слой.

Минимум:
- одна качественная canonical cover image на модель;
- по мере наполнения — отдельная cover image поколения/рестайлинга.

Предпочтительный визуальный стандарт:
- автомобиль целиком;
- чистый 3/4 front или иной единый каталоговый ракурс;
- без водяных знаков/рекламы;
- без случайного дилерского окружения;
- прозрачный фон — когда источник/лицензия/production pipeline позволяет;
- одинаковая композиция и scale для каталога.

Для каждого media asset хранить:
- source;
- original URL/source reference;
- license;
- attribution if required;
- model/generation identity;
- media status;
- optional transparent-background derivative.

Нельзя брать случайное объявление другой комплектации/поколения как canonical cover.

---

## 10. SEO architecture

Основной граф:

```text
/cars/brand/<brand>
/cars/brand/<brand>/model/<model>
/cars/brand/<brand>/model/<model>/<generation>
/cars/brand/<brand>/model/<model>/<generation>/<variant>
```

Не индексировать автоматически каждую слабую/непроверенную variant-сущность.

SEO page eligibility зависит от достаточного verified content.

Страница модели должна покрывать интенты:
- характеристики;
- поколения;
- двигатели;
- размеры;
- мощность;
- привод;
- расход;
- клиренс;
- багажник;
- EV/PHEV battery/range/charging;
- текущие предложения;
- стоимость под ключ;
- таможня/утиль там, где применимо.

Encyclopedia + live offers + calculator формируют единую SEO-page, а не три разрозненных продукта.

---

## 11. UI — направление

Текущая страница бренда считается прототипом и должна быть переработана на реальных V2-данных.

### Brand page

Рекомендуемый порядок:
1. compact hero brand;
2. краткие counters: models / live offers / markets;
3. popular models with visual covers;
4. all models directory;
5. filters: body / EV / hybrid / active / discontinued etc.;
6. live market context;
7. contextual lead CTA;
8. useful SEO content/FAQ.

Канонические модели не смешивать с aliases/series/drive names/random tokens.

### Model page

Рекомендуемый порядок:
1. model hero + cover;
2. production years / body / powertrain summary;
3. calculate / current offers actions;
4. generation timeline;
5. variants/specifications;
6. dimensions/performance/EV sections;
7. live offers;
8. contextual lead CTA;
9. related models;
10. SEO/FAQ.

### Live offer page — all specifications

Карточка показывает только основные характеристики.

Кнопка: **«Все характеристики»**.

Desktop:
- раскрываемая inline-section на странице;
- без отдельного modal, если нет особой причины;
- можно свернуть обратно.

Mobile:
- bottom sheet / near-fullscreen sheet;
- логика взаимодействия как у уже используемого mobile course sheet;
- характеристики сгруппированы в вертикальные секции;
- иконки используются там, где помогают сканированию.

EV/PHEV получает отдельные группы: motor / battery / charging / range / consumption.

---

## 12. Contextual lead CTA

Блок «Не нашли автомобиль?» обязателен, но должен быть контекстным.

На model page пример:

**Не нашли подходящий Audi Q2?**  
Менеджер проверит доступные рынки и рассчитает подходящий вариант.

Основное размещение:
- после live offers;
- до related models / lower SEO content.

CTA должен знать brand/model текущей страницы и передавать их в lead.

---

## 13. Связь с live catalog

Parser minimal truth:
- market;
- source;
- sourceOfferId;
- sourceUrl;
- make;
- model;
- year;
- price/currency;
- mileage if source provides;
- listing-bound photos;
- exact source fields that are actually known.

Encyclopedia enrichment:
- canonical model;
- generation;
- variant;
- technical specs;
- trusted calculation inputs.

Нельзя заставлять каждый рыночный парсер становиться автомобильной энциклопедией.

---

## 14. Старт реализации

До старта V2 завершается certification/autonomous daily loop семи рынков.

После PASS рынка Японии и итогового all-6 production audit команда пользователя **«Энциклопедия»** означает начать реализацию в таком порядке:

1. финальный schema/contract V2 на базе этого документа;
2. ingestion foundation;
3. canonical resolver;
4. Wikidata/Commons global pass;
5. official regional source adapters;
6. chunked JSON output + validators;
7. первые pilot brands на настоящих данных;
8. только после реальных V2-данных — финальный redesign brand/model pages;
9. связать V2 с offer «Все характеристики»;
10. расширять coverage волнами до глобальной базы.

Начальный pilot допускается на Audi/BMW/Toyota/BYD/Geely либо другом наборе, если он лучше покрывает текущие рынки и проверку источников.

---

## 15. Не пересматривать без причины

Утверждено пользователем:

- гибридный сбор: Codex + ручной контроль;
- open/official multi-source ядро, а не один коммерческий сайт;
- canonical `brand → model → generation → facelift → variant`;
- provenance;
- отдельный EV/PHEV deep layer;
- canonical cover images;
- SEO-first entity graph;
- responsive desktop/mobile Encyclopedia UI;
- inline desktop specs + mobile bottom sheet;
- contextual «Не нашли авто?» CTA;
- связь Encyclopedia → live offers → существующий calculation engine.

Эти решения считаются baseline проекта Encyclopedia V2.
