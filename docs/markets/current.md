# Текущий шаг

Checkpoint: **28.11.2026, Asia/Krasnoyarsk**. Все подготовленные правки Японии опубликованы и приняты. Конечная очередь разрешённой REG retention завершена; незакрытых правок Японии нет.

## Принятая Япония

- [Выпуск №33](https://github.com/jeep-jim/AvtoCena/actions/runs/46051339049) — **SUCCESS / accepted**, завершён **28.11.2026 02:00:16 Asia/Krasnoyarsk**. `completed=true`, `published=true`, `retentionPreserved=true`, `leaseReleased=true`.
- Runtime **`b9e9122b75f4e588088d0241476b18df7f047d96`**, tree `4e2c36e461416d6db7d0f52753c9a933d626dd5c`, image `sha256:7b97f99ee72af7b50944c98a94a670bcb347b9779794d78b34fdc92279460216`. Trigger `a697a7b1c78a4d362134c2c3ab84dc0be5809a4d`, controller `4e62111a5598a7d77304d697a02e8a014d93b798`.
- **Все 16 Japan functional flags и общий `passed=true`.** В live проверке подтверждены 44/44 fresh марки desktop/mobile, выбор модели по точной source identity, фильтры, страницы 24+24, pagination, мощность и порядок, город, detail/input/расчёт, связанные карточки, видимость, удаление общего warning и vehicle policy.
- Model journey: 9 exact пар make/model и 8 normalized names, выбранная Mazda 6, 24 fresh строки и точное совпадение UI/API/города. Combined filters: grade5 + automatic + petrol + powerTo160. Related: 3 fresh Japan карточки и 1 validated green stock. Vehicle policy: проверены 96 строк, запрещённых видимых — 0.
- [Verify №65](https://github.com/jeep-jim/AvtoCena/actions/runs/46050444852): **1618/1618 controller**, **557/557 native**, web/engine typecheck и обязательные fixtures PASS. Real Chromium legacy8, model4 и Retry3 прошли и в выпуске33. Проверены digest/CRC, 19 screenshots и image/source/nonce/manifest bindings.
- Exact scope: **59 runtime / 113 pricing paths**. Pricing `64c6338e0db23c8999096bceefbf113c0136fe15` и защищённые формулы сохранены. Принятое поколение данных — `gen_china_45875678028_1`.
- Время только наблюдается: **`speedGateRequired=false`, `speedPassed=null`, `latencyThresholdApplied=false`**. Broad server benchmark не является условием выпуска. Read-only browser fence сохранён; production mutations и direct supplier API requests — 0.

## Включённые исправления

- Полный доступный источник японских марок и моделей; при пустом, stale или ошибочном справочнике — реальные видимые марки и рабочая кнопка «Повторить», без выдуманного статического списка.
- Первый пустой makes/models aggregate требует точного fresh COUNT=0. Старый empty без доказательства не выдаётся fresh; полезные названия не затираются, запоздавший zero не побеждает новое положительное наблюдение.
- Сохранены source identity, город, совместные фильтры, страницы по 24 при наличии продолжения, известная мощность перед неизвестной, detail, цены и related cards. Убрано длинное общее пояснение мощности; факты конкретной карточки сохранены.
- Исключаются подтверждённые автобусы, грузовики, спецтехника и полная масса >3500 кг. Общего запрета van/N1 нет. PW — целое л.с. по уточнению поставщика26.11; неизвестная мощность обозначается явно.
- Shared-home fallback изолирован по рынкам при отсутствующем/stale/incomplete overview. Global TTL, LIST, расчётные формулы, энциклопедия и редакторские сведения сохранены.
- Исправлены hydration/readiness, legacy canonical navigation, обработка HTTP-error body и привязка выбора модели к точной паре make/model после обновления списка. Локальные регрессии и live proof приведены в подробном отчёте.

## Обслуживание после публикации

- [Read-only observer](https://github.com/jeep-jim/AvtoCena/actions/runs/46054235990) подтвердил current **B9**, rollback **a5ca426eec2663eb17c2df69fe2bfed46e2b8740**, оба на generation C и прежнем pricing. State stable/resolved/committed, lease released, state mutations — 0. Исторические witnesses не переписаны.
- [REG №12](https://github.com/jeep-jim/AvtoCena/actions/runs/46067152151) — **SUCCESS / complete**, завершён **28.11.2026 04:20:29 Asia/Krasnoyarsk**. **`completed=true`, `pending=0`, `leaseReleased=true`**. Последняя задача: 1,911 объектов запланированы, захвачены, проверены и подтверждённо удалены; объём — 3,205,484,967 B. Это счётчик объектов REG, не измерение свободного host disk.
- Первая задача завершена и удалена из очереди в [REG №10](https://github.com/jeep-jim/AvtoCena/actions/runs/46064292305): все 1,948 исходных объектов проверены, 1,921 уже отсутствовал и 27 удалены в том запуске. №12 закрыл последнюю задачу. Неопределённые исходы №9 не суммируются как дополнительные подтверждённые удаления.
- Финальный REG отчёт подтвердил current B9 / generation C / accepted revision64, нулевые accepted/intent writes, supplier requests, source preparations, application builds и publication reservations. Финальные authority guards требуют прежнюю current/rollback пару и неизменные accepted/intent observations. Host cleanup завершён, но host filesDeleted/freedBytes/retiredContainers в №12 — 0.
- Обслуживание исправлено узко: `c9a4bf89` — opt-in reads8 / последовательные part batches≤64 с сохранением всех guards, **71/71 PASS**; `900db5f9` — один release factory на запуск после удаления ambient SSH key, **37/37 PASS**. Оба exact commits независимо проверены. Опубликованы controller `3f7013fe` и `d62f827c`; итоговый marker **`b3b13768`**. Runtime B9 не менялся.
- Host cleanup самого выпуска33 подтвердил удаление одного retired container и exact old077c image; измеренный прирост свободного места — **1,190,977,536 B**. Очистка всех возможных старых Docker images этим не утверждается.
- [AJ №1](https://github.com/jeep-jim/AvtoCena/actions/runs/46058750705) — **SUCCESS, ограниченный проход**: проверены 33 payloads, 22 просроченные записи уплотнены, 11 сохранены; logical payload уменьшен на **93,574 B**. Ошибок и неподтверждённых записей — 0, checkpoint сохранён. `scanCycleCompleted=false`, working cache object DELETE — 0, supplier/source requests — 0, `hostDiskMeasured=false`.
- Ежечасный AJ cron **`43 * * * * UTC`** опубликован. Фактический scheduled checkpoint-resume в двух однократных наблюдениях до **21:22:03 UTC** ещё не обнаружен; полный обход кэша и физическое освобождение диска не заявляются. Принудительный повтор не выполнялся.

## Дальнейшая работа

Новых незакрытых правок Японии и задач этой конечной REG очереди нет. Для AJ предусмотрены последующие ограниченные проходы по опубликованному расписанию; исходный checkpoint подтверждён. Рабочий AJ DELETE запрещён: только guarded conditional PUT. AJ используется только для Японии через реальные запросы посетителей и ограниченный кэш, без дампа/зеркала; fresh30мин, stale fallback строго <7суток с исходной датой.

[Подробные bindings, история попыток, ограничения доказательств и хэши артефактов](../operations/2026-11-27-japan-directory-completion.json). Не применять observers29–32 к текущей публикации: accepted owner —33.
