# Catalog source field audit v1 — evidence

Статус: read-only source-bound qualification evidence. Этот документ **не разрешает публикацию** и не меняет `class`/`publishAllowed` ни у одного кандидата.

Машиночитаемая сводка: `data/catalog/source-field-audit-v1-summary.json`.

## Проверенный запуск

- Workflow run: `33731675254` — `success`.
- Head SHA: `286af00b134c3d2c51da039d7ca2286757bb104f`.
- Artifact: `9884112823`.
- Digest: `sha256:4dc1b6fa50e7607676d5723b9465dc75cb98f5be6f4c345ad56bd980bd7358f8`.
- Generated: `2026-09-03T08:08:41.845Z`.
- Объём: `4` источника, `8` detail samples, каждый URL запрошен дважды.
- Все этапы workflow прошли успешно: qualification/field-audit tests, source-bound audit, conservative postprocess, no-write envelope, artifact upload.
- Матрица недостающих полей совпала с предыдущим зелёным run `33731051049`; между ними изменились только счётчики просмотров на двух Bobaedream pages, не source-bound значения автомобиля.
- Во всём контуре: `productionWrites=false`, `classificationMutations=false`, `publishAllowedMutations=false`, `rawBodiesStored=false`.

## Итог

Ни один из четырёх сильнейших кандидатов пока не прошёл полный source-level exact contract. `classificationDecision=deferred` для всех. Это значит: **не присваиваем `exact_catalog`, не включаем публикацию и не ослабляем offer-level gate**.

При этом полевая проверка сузила реальные недостающие данные. Наиболее близкий кандидат — Bobaedream: на двух проверенных объявлениях доказаны identity, марка/модель/год, фактическая цена в KRW, fuel, точный `engineCc` и `powerHp`; не доказаны только канонический body type и listing-bound gallery.

## Bobaedream — `bobaedream_korea_candidate`

Доступность двух detail URL повторяема; оба повторных запроса стабильны.

### Offer `2260063`

`https://www.bobaedream.co.kr/mycar/mycar_view.php?no=2260063&gubun=K`

Доказано source-bound:

- make: `기아`;
- vehicle title/model: `올 뉴 K7 2.4 프레스티지`;
- year: `2016`;
- listing price: `1,200 만원` = `12,000,000 KRW`;
- fuel: petrol/`가솔린`;
- engine: `2,359 cc`;
- power: `190 마력`.

Не доказано:

- canonical body type;
- минимум пять уникальных listing-bound фотографий.

### Offer `2262188`

`https://www.bobaedream.co.kr/mycar/mycar_view.php?no=2262188&gubun=K`

Доказано source-bound:

- make: `현대`;
- vehicle title/model: `제네시스 DH G330 AWD 프리미엄`;
- year: `2016`;
- listing price: `1,480 만원` = `14,800,000 KRW`;
- fuel: petrol/`가솔린`;
- engine: `3,342 cc`;
- power: `282 마력`.

Не доказано:

- canonical body type;
- минимум пять уникальных listing-bound фотографий.

Source verdict: `exactReady=false`; deficit counts: `body=2`, `gallery=2`.

## CarSwitch — `carswitch_uae_candidate`

Оба detail URL повторяемо доступны. JSON-LD привязывает к конкретным объявлениям identity/model/year/price/currency/body/fuel и галерею из 10 изображений.

Проверенные samples:

- Chevrolet Captiva 2025 / offer `864601`: `49,650 AED`, `SUV`, petrol, `10` JSON-LD images; source engine displacement=`1.5` без явной единицы; horsepower отсутствует.
- Dodge Durango 2013 / offer `857416`: `13,500 AED`, `SUV`, petrol, `10` JSON-LD images; source engine displacement=`5.7` без явной единицы; horsepower отсутствует.

Важное правило: `1.5` и `5.7` **не переводятся автоматически в cc**, потому что unit на проверенном source-bound поле не доказан. Source verdict: `exactReady=false`; deficit counts: `engineCc=2`, `powerHp=2`.

## CARS24 UAE — `cars24_uae_candidate`

Оба detail URL повторяемо доступны. Offer-local embedded data устойчиво привязывает к listing ID make/model/year/body/fuel; по каждому sample найдено `15` URL изображений с listing ID.

Проверенные samples:

- Chevrolet Groove 2023 / offer `9714841569`: make/model/year/body/fuel/gallery доказаны; на странице диагностически виден `31,499 AED`, но binding этой цены к offer-local object пока не доказан; engine=`1.5` без доказанной единицы; power отсутствует.
- Ford Territory 2024 / offer `9714841918`: make/model/year/body/fuel/gallery доказаны; на странице диагностически виден `64,999 AED`, но binding этой цены к offer-local object пока не доказан; engine=`1.8` без доказанной единицы; power отсутствует.

Мы отдельно закрыли ложный риск: общая страница содержит ссылки/текст про electric cars, однако конкретные offer-local objects этих двух машин задают `Petrol`. Поэтому `engineCc` не имеет права становиться `not_applicable` из-за общего текста страницы.

Source verdict: `exactReady=false`; deficit counts: `price=2`, `engineCc=2`, `powerHp=2`.

## DubiCars — `dubicars_uae_exact`

Оба detail URL повторяемо доступны.

### Hyundai Veloster 2019 / offer `740206`

JSON-LD/страница доказывают identity, make/model/year, price=`8991 USD`, Hatchback, Petrol. Не доказаны exact `engineCc`, `powerHp` и listing-bound gallery >=5; vehicle JSON-LD содержит только одно изображение.

### BMW iX1 2023 / offer `979972`

JSON-LD/страница доказывают identity, make/model/year, price=`54500 USD`, SUV/Crossover, Electric, peak power=`313 HP`; для EV `engineCc=not_applicable` корректен. Не доказаны certified/utilization/30-minute power, требуемая расчётным контрактом, и listing-bound gallery >=5.

Peak `313 HP` **не считается** certified/30-minute power.

Source verdict: `exactReady=false`; deficit counts: `engineCc=1`, `powerHp=1`, `gallery=2`, `certifiedPower=1`.

## Почему классы пока не меняются

Field audit проверяет только известные публичные detail representations. Контракт требует перед окончательным `lead_only`/`rejected` проверить разрешённые публичные alternate routes, embedded state/API или официальный feed, если они могут дать недостающие source-bound значения. Защиты, login wall и robots restrictions обходить нельзя.

Поэтому четыре кандидата остаются `research_pending`, `publishAllowed=false`.

## Следующая точка продолжения

1. Bobaedream: найти разрешённое source-bound поле canonical body type и доказать listing-bound gallery >=5.
2. CarSwitch: найти явную единицу displacement/точный `engineCc` и source-bound `powerHp`.
3. CARS24: привязать цену к конкретному offer-local object, найти явную единицу engine displacement и `powerHp`.
4. DubiCars: для ICE найти `engineCc`/`powerHp`; для всех samples доказать gallery identity; для EV/Hybrid найти certified/utilization/30-minute power, если источник её предоставляет.
5. Только после этого присваивать `exact_catalog`, `lead_only` или `rejected`. До решения production generation не трогать.
