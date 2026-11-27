# Текущий шаг

Checkpoint: **28.11.2026, Asia/Krasnoyarsk**. Япония опубликована; завершается уже разрешённое обслуживание хранения.

## Принятая публикация

- [Выпуск №33](https://github.com/jeep-jim/AvtoCena/actions/runs/46051339049) **SUCCESS / accepted**, завершён **28.11.2026 02:00:16 Asia/Krasnoyarsk**. `completed=true`, `published=true`, `retentionPreserved=true`, `leaseReleased=true`. Trigger `a697a7b1c78a4d362134c2c3ab84dc0be5809a4d`, controller `4e62111a5598a7d77304d697a02e8a014d93b798`.
- Действующий runtime **`b9e9122b75f4e588088d0241476b18df7f047d96`**, tree `4e2c36e461416d6db7d0f52753c9a933d626dd5c`, image `sha256:7b97f99ee72af7b50944c98a94a670bcb347b9779794d78b34fdc92279460216`. Exact **59 runtime / 113 pricing paths**, защищённый pricing неизменен; принят Китай **`gen_china_45875678028_1`**.
- **Все16 Japan functional flags и общий passed=true.** Live подтверждены fresh44/44 марки desktop/mobile, страницы24+24 и pagination, мощность/order, город, detail/input/расчёт, видимость и удаление длинного warning, legacy Mazda3, настоящий выбор модели, combined filters, related cards и vehicle policy.
- Model journey:9exact pairs/8normalized names, выбранная Mazda6 из источника,24fresh rows, точные UI/API/город. Combined: grade5+automatic+petrol+power160. Related:4карточки —3freshJapan и1validatedgreenstock; source IDs совпали. Vehicle policy:96строк проверены, запрещённых видимых0.
- [Verify №65](https://github.com/jeep-jim/AvtoCena/actions/runs/46050444852): **1618/1618 controller**, **557/557 native**, web/engine typecheck и все обязательные fixtures PASS. Real Chromium legacy8, model/source identity4 и Retry3 также прошли в самом выпуске33. Artifact digest/CRC,19screenshots и image/source/nonce/manifest bindings проверены.
- Время только наблюдается: **`speedGateRequired=false`, `speedPassed=null`**, `latencyThresholdApplied=false`, broad server benchmark не выполнялся. Read-only browser fence сохранён, production mutations0 и direct supplier API requests0.
- Host cleanup подтвердил1retired container и удаление exact old077c image; measured free-byte change **1,190,977,536B** относится только к этому образу. Общая очистка всех возможных старых Docker images этим не утверждается.

## Действующее поручение и включённые исправления

- Владелец повторно отменил блокировку Японии по секундам и скорости соседних разделов, включая выпуск кода. Используется **`japan-functional-observed-timing-v1`**: собственная функциональная проверка Японии, сохранённые данные/rollback и реальные наблюдения времени; **`speedGateRequired=false`, `speedPassed=null`**. Общая скорость не является условием этого выпуска.
- B9 включает полный доступный источник японских марок и моделей; при пустом/stale/error справочнике сохраняются реальные видимые марки и настоящая кнопка «Повторить». Статический выдуманный список и принятие fallback за полный справочник исключены.
- Первый пустой makes/models aggregate требует точного fresh COUNT=0; старый empty без доказательства не выдаётся fresh. Полезные названия не затираются, запоздавший zero не побеждает новое положительное наблюдение. Global TTL, LIST, формулы и другие рынки сохранены.
- Сохранены порядок известной/неизвестной мощности, страницы по24 при наличии продолжения, точная source identity, город, фильтры, detail, цены и связанные карточки. Длинное общее пояснение мощности убрано с японских rails; сведения конкретной карточки сохранены.
- Исключаются подтверждённые автобусы, грузовики, спецтехника и полная масса >3500кг; blanket-запрета van/N1 нет. PW — целое л.с. по уточнению поставщика26.11; неизвестная мощность обозначается честно.
- Shared-home fallback изолирован по рынкам при отсутствующем/stale/incomplete overview. Не возвращать obsolete all-alias и общий скоростной барьер.
- Controller исправляет ожидание hydration, legacy canonical navigation и HTTP-error body: JSON читается только для200, все свежие source/UI proofs сохранены. Fixture сохраняет диагностику до cleanup. Exact authored fixes и проверки зафиксированы в подробном отчёте.



## Следующие действия

1. Опубликовать reviewed maintenance33 и выполнить read-only observer для фактической принятой пары current/rollback.
2. По этой паре обновить только два REG runtime pins; закончить retention с освобождённым lease.
3. Активировать guarded AJ compaction и проверить её фактический отчёт.

## Хранение и границы

- Maintenance33 готов и независимо проверен: core **`4ef96d16`**, observer **`e2275bbf`**, **20/20** targeted tests. Exact owner `46051339049 / attempt1 / a697a7b1 / B9`. Девять core paths побайтово прежние. Код пока локальный, markers отсутствуют, REG pins **c6/a5** не изменены; actual pair ещё не наблюдалась отдельным observer.
- Исторические A/B/C witnesses не переписывать. Рабочий AJ DELETE запрещён; compaction использует conditional PUT и уменьшает logical payload, не доказывает физическое освобождение host disk. Ни один observer не применять к откатившемуся или отменённому выпуску.
- AJ — только Япония: реальные запросы посетителей и ограниченный кэш, без дампа/зеркала; fresh30мин, stale fallback строго <7суток с исходной датой. Pricing **`64c6338e0db23c8999096bceefbf113c0136fe15`**, формулы, энциклопедия и редакторские сведения сохраняются.
- [Подробные bindings, история попыток, ограничения доказательств и хэши артефактов](../operations/2026-11-27-japan-directory-completion.json). Observers29–32 не запускать; accepted owner теперь33.
