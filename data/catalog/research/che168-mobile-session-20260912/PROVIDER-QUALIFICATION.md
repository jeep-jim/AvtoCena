# China bulk-source qualification — 2026-09-12

Status: no supplier qualified for publication. No purchase, registration, provider message, production configuration change or catalog publication performed.

## Public sample inspection

The CSV exports linked by [Auto-Parser Che168](https://auto-parser.ru/parser_che168_com) and [Dongchedi](https://auto-parser.ru/parser_dongchedi_com) were downloaded on 2026-09-12. See provider-sample-audit.json for checksums, column names, counts and sheet links. Full third-party samples were inspected locally, not republished here.

- Che168: 129 unique source IDs, all URLs on www.che168.com. created_at is 2025-04-29. No year >=2020 and no power column.
- Dongchedi: 1,659 unique source IDs, all URLs on www.dongchedi.com. created_at is 2025-10-10. 984 rows have year >=2020; 216 of those report power >0 and <=160. These are supplied values, not independently confirmed manufacturing years or calculation inputs.
- Dongchedi photo URLs: 24,338 total; 20,419 contain x-expires timestamps in 2025-10-18. Those declared expirations precede inspection. Images were not downloaded or tested, so HTTP failure is not asserted.
- Neither sample establishes present availability, current seller price, correct cash-price interpretation, verified power provenance, or current supplier coverage. Neither is publishable evidence.

Counting method: CSV DictReader with quoted multiline fields preserved; unique inner_id; year numeric >=2020; optional reported horse_power >0 and <=160. URL host parsed per row. Photo arrays decoded, x-expires parsed as Unix UTC seconds. No inference from displacement to power.

## Candidate delivery contracts

[Auto-API Che168](https://auto-api.com/che168) and [Dongchedi](https://auto-api.com/dongchedi) document initial paginated offers, added/changed/removed events, and daily exports. Access requires an assigned access_name and API key. These are supplier claims, not tested service availability. Chinese pages label price CNY. Displacement units differ across documented routes; original exact cc must be preserved instead of converting a rounded litre value into purported exact displacement. No current endpoint, commercial quote or publication-rights confirmation received.

[Carapis](https://carapis.com/platforms/east-asia/che168) documents source=che168 and Bearer-key access, with an unofficial API designation. Domestic record provenance remains unverified. [Pricing](https://carapis.com/pricing) advertises a registration-based trial. No signup or paid plan was activated.

No claim that these brands are independent operators or that advertised quantities are verified.

## Global comparison

Searches for Global counterparts of domestic IDs 58328510, 59859616 and 59875559 did not provide paired quotes. No equality or price difference calculated. Search-index excerpts for Global show FOB labels, but the attempted full page read timed out; this is insufficient to establish same-car price equality. Global remains unqualified under the owner's condition.

## Concrete next dependency

Fresh read-only trial feed or JSON/CSV sample from a candidate supplier, with permission to use the supplied listings on AvtoCena. Public historical examples are insufficient. Draft request below is NOT SENT.

Recipient candidate: info@auto-parser.ru (listed at https://auto-parser.ru/parser_che168_com).
Alternative candidate: access@auto-api.com (listed at https://auto-api.com/che168).
Do not order, subscribe, register, or send until the corresponding action is authorized.

### Draft request

Здравствуйте! Проверяем источник данных для каталога АвтоЦена (avtocena.com). Нужны актуальные объявления внутреннего рынка Китая: domestic Che168, Dongchedi и Guazi. Global/export нельзя подменять под domestic.

Перед выбором сервиса просим бесплатный тестовый доступ только для чтения либо свежую JSON/CSV-выгрузку минимум 1000 уникальных активных объявлений, с отдельным количеством по каждому источнику. Основной интерес — автомобили 2020 года и новее; мощности не достраивать.

Для проверки нужны: исходный ID и URL, дата проверки актуальности, марка/модель/комплектация, полная цена покупки за наличные в CNY с пояснением скидок и кредитных условий, год модели отдельно от даты производства и первой регистрации, точный рабочий объём в см³, мощность с единицей и исходным полем/таблицей, тип топлива, исходные таблицы характеристик, галерея URL и способ обновления истекающих ссылок. Отсутствующие данные должны оставаться пустыми.

Просим описать начальную выгрузку и обновления добавлено/изменено/снято, фактический текущий объём по источникам, условия размещения данных и ссылок на фото в публичном коммерческом каталоге, происхождение/право передачи данных, стоимость и лимиты после теста. Это запрос информации и бесплатного образца, не заказ платных услуг.

Для дополнительной сверки domestic Che168 интересуют ID 58328510, 59859616, 59875559, если они ещё активны. Старые записи не выдавать за действующие.

## Acceptance

First verify fresh source-bound sample and price semantics; then offline normalization preserving raw; exact calculation only with confirmed inputs; then full CI and existing publication/audit gates. Initial target 1000 is a validation milestone, not a reduced catalog limit. No current collection process was started by this research.
