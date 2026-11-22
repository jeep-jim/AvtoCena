# Фиды и расписания

Проверено: 22.11.2026, 19:41 Asia/Krasnoyarsk. Готовность всех фидов и новая публикация Китая не подтверждены.

## Контракт

Каждый рынок обновляется независимо. Данные, цены и индексы готовятся в фоне; курс фиксируется для версии. Сохраняются ручные значения, неизвестные параметры, полнота, lease/CAS и предыдущий рабочий срез. Ошибка источника не является продажей. Японию и свежий Зелёный угол повторно не собирать.

## Штатное расписание

Контракт: `scripts/lib/catalog-refresh-schedule.mjs` и `.github/workflows/catalog-refresh-<market>.yml`. Cron проверяет окно, interval guard определяет нужный день.

| Рынок | UTC+7 | Интервал | Последний известный результат |
| --- | --- | --- | --- |
| Китай | 21:00 | Ежедневно | Сохранены загрузка и prepared intake; автоматическое публичное продолжение не подключено |
| Корея | 00:00 | 2 дня | [45004098806](https://github.com/jeep-jim/AvtoCena/actions/runs/45004098806): failure на retained Europe coverage; исправленные характеристики ещё не опубликованы |
| ОАЭ | 00:00 | 2 дня | [44990370917](https://github.com/jeep-jim/AvtoCena/actions/runs/44990370917), попытка 2: terminal результат ещё нужно проверить |
| Грузия | 00:00 | 2 дня | [44968899905](https://github.com/jeep-jim/AvtoCena/actions/runs/44968899905): MyAuto transport failure; intake неполон |
| Европа | 00:00 | 3 дня | [44976801536](https://github.com/jeep-jim/AvtoCena/actions/runs/44976801536): coverage guard остановил публикацию; нужен исправленный workflow |

## Проверки PR 1801

[PR 1801](https://github.com/jeep-jim/AvtoCena/pull/1801): head `20ca52413c2d8c63063961c9358285c5064f3c71`, tree `1b3e7755612c5824a733a33a5062725add6e1fbe`. Локально `npm test`: 3 386 / 3 386, без skipped; TypeScript web и engine PASS; 25 editorial и owned guards PASS. Mobile.de остаётся выключенным, действующие ограничения источников сохранены.

[CI 45022338709](https://github.com/jeep-jim/AvtoCena/actions/runs/45022338709) и [45022383527](https://github.com/jeep-jim/AvtoCena/actions/runs/45022383527) завершились успешно, включая production build. PR принят в main: `2686cc203a1dd5e38b38d29d84423145f2aeeb16`. Установка нового runtime сайта этим merge не выполнялась.

[Overview 45023361500](https://github.com/jeep-jim/AvtoCena/actions/runs/45023361500) завершился успешно на исправленном main. Для `gen_1794878284419_a611dfcf` подтверждены `alreadyPrepared:true` на 22, 23 и 24 ноября. Установленный 22867 честно вернул `supported:false, prepared:false, reason:known_pre_helper_release`; это не заявленная готовность отсутствующего editorial helper. Ошибка совместимости устранена.

## Китай: сохранённый вход публикации

[Загрузка 44945974384](https://github.com/jeep-jim/AvtoCena/actions/runs/44945974384): 5 530 событий, 278 страниц, cursor 13205327. [Подготовка 44947482013](https://github.com/jeep-jim/AvtoCena/actions/runs/44947482013): 290 560 observations. Публичный Китай этим не переключён.

Ветка `fix/china-publication-source-20261122`, [SHA b209f4f27ad84eae2878c4535e0daa269593a981](https://github.com/jeep-jim/AvtoCena/commit/b209f4f27ad84eae2878c4535e0daa269593a981): 15 тестов PASS. Adapter связывает official run/attempt/SHA, archive, frozen rates, cursor, replica manifest, срок источника и China control/ETag. Возвращается только входной план: native admission, полный active/retirement proof, price seal, private preview и CAS ещё нужны. Индекс — в [документе скорости](performance.md).

## Грузия: установленная причина и предел диагностики

В [job 137044250368](https://github.com/jeep-jim/AvtoCena/actions/runs/44968899905/job/137044250368), artifact 14738319396, `report.json` содержит три одинаковых `yandex_bridge_http_502_myauto_1_myauto_list_routes_failed:...fetch_failed`. У MyAuto 0 страниц, строк и попыток деталей; AutoPapa сохранил 1 149 наблюдений. 502 сформирован нашим Yandex worker после ошибки fetch до разбора HTML; это не доказательство HTTP 502 или Cloudflare-блокировки MyAuto.

Adapter сохраняет только `error.message`; route и bridge дополнительно обрезают текст. DNS, TLS, connect timeout, egress и недоступность поставщика по этому artifact не различить. Следующий шаг — безопасно записывать `error.name` и `error.cause.code/name` в worker и проверить следующий штатный запуск без внепланового сбора.

## Следующие действия

1. Korea завершилась failure: использовать готовый intake после исправления совместимости индексов; [короткий разбор и проверка характеристик](../operations/korea-characteristics.md). Terminal результат UAE ещё нужно проверить. Пересекающиеся writers не запускать.
2. Европу повторять только из сохранённого intake на исправленном workflow, без ослабления retained-market coverage.
3. Завершить независимую публикацию Китая с индексом и действующими guards. Старые одноразовые rev5 pins не менять; до принятия нового среза сохранять текущий.
4. Overview: обычные триггеры — cron 17:05 UTC и завершение UAE, manual на main с inputs `{}`, существующий push marker. Listener завершения Korea paid publish отсутствует. Весь main как runtime не выпускать.
