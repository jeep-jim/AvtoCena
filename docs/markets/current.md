# Текущий шаг

Checkpoint: **28.11.2026, Asia/Krasnoyarsk**. Работа продолжается только по Японии и затронутому общему пути главной.

## Фактический статус

- [Выпуск №32](https://github.com/jeep-jim/AvtoCena/actions/runs/46046207658) **rolled_back** в 18:20:08.763 UTC. Trigger `aa0d0c0b15c3d0e7fc913c8fa3fb08ecab4af679`, controller `ced75a511f9009d48faaed3f16e9f83cc947f024`. Собственная live-проверка остановилась на `stability_model_selection / japan_browser_stability_model_duplicate`, timeout=false. Восстановление, retention и освобождение lease подтверждены; exact failed image удалён.
- Runtime **`b9e9122b75f4e588088d0241476b18df7f047d96`**, tree `4e2c36e461416d6db7d0f52753c9a933d626dd5c`. Exact source/pricing proof прошёл: **59 runtime / 113 pricing paths**, защищённые pricing paths не изменены, frozen HTTP oracle применим.
- [Verify №64](https://github.com/jeep-jim/AvtoCena/actions/runs/46045571108) **SUCCESS** на этом controller/runtime: **1615/1615 controller**, **557/557 native** в одном чистом hosted запуске, web/engine typecheck и все обязательные fixtures PASS.
- Реальный Chromium Retry fixture **3/3 PASS**: mobile empty→Retry→полный свежий источник; desktop HTTP503→dropdown Retry и независимый rail Retry/remount→полный источник; повторно пустой ответ строго отвергнут. Legacy **8/8**, model readiness **2/2**. Все эти gates прошли также в самом выпуске32 до build/host.
- Live32 подтвердил свежие **44/44** марки desktop/mobile, страницы **24+24**, мощность/город/расчёт/detail/видимость и legacy Mazda3 **308→200**, точные API/UI/city. Hydration и brand navigation прошли; отказ при проверке9 model options до выбора модели. Сырые9pairs не сохранены. Combined/related/vehicle проверки не завершены.
- На exact B9 компоненте воспроизведено несовпадение: UI сохраняет точные пары raw make/model, а controller считает дублем normalized(model) без make. Исправление **`2d4c39ca`** готово: exact tuple uniqueness и strict attribute-bound click при async reorder; настоящий одинаковый tuple и non-source вариант отвергаются. **66/66** affected tests PASS, independent review PASS; hosted **4** actual browser cases ещё ожидаются. Runtime B9 не изменён. Это воспроизведение контракта, а не восстановленные9livepairs.
- Последняя подтверждённая принятая версия пока **`a5ca426eec2663eb17c2df69fe2bfed46e2b8740`**, Китай C. До terminal accepted отчёта runtime B9 не считать установленным.

## Действующее поручение и включённые исправления

- Владелец повторно отменил блокировку Японии по секундам и скорости соседних разделов, включая выпуск кода. Используется **`japan-functional-observed-timing-v1`**: собственная функциональная проверка Японии, сохранённые данные/rollback и реальные наблюдения времени; **`speedGateRequired=false`, `speedPassed=null`**. Общая скорость не является условием этого выпуска.
- B9 включает полный доступный источник японских марок и моделей; при пустом/stale/error справочнике сохраняются реальные видимые марки и настоящая кнопка «Повторить». Статический выдуманный список и принятие fallback за полный справочник исключены.
- Первый пустой makes/models aggregate требует точного fresh COUNT=0; старый empty без доказательства не выдаётся fresh. Полезные названия не затираются, запоздавший zero не побеждает новое положительное наблюдение. Global TTL, LIST, формулы и другие рынки сохранены.
- Сохранены порядок известной/неизвестной мощности, страницы по24 при наличии продолжения, точная source identity, город, фильтры, detail, цены и связанные карточки. Длинное общее пояснение мощности убрано с японских rails; сведения конкретной карточки сохранены.
- Исключаются подтверждённые автобусы, грузовики, спецтехника и полная масса >3500кг; blanket-запрета van/N1 нет. PW — целое л.с. по уточнению поставщика26.11; неизвестная мощность обозначается честно.
- Shared-home fallback изолирован по рынкам при отсутствующем/stale/incomplete overview. Не возвращать obsolete all-alias и общий скоростной барьер.
- Controller исправляет ожидание hydration, legacy canonical navigation и HTTP-error body: JSON читается только для200, все свежие source/UI proofs сохранены. Fixture сохраняет диагностику до cleanup. Exact authored fixes и проверки зафиксированы в подробном отчёте.

## Следующие действия

1. Опубликовать reviewed controller `2d4c39ca`, подтвердить4actual browser cases в hosted verification, затем довести следующий выпуск до фактической собственной live acceptance Японии.
2. После принятия перенести подготовленный observer на фактически принятый выпуск, опубликовать обслуживание и прочитать реальную пару current/rollback.
3. По этой паре обновить только два REG runtime pins; закончить retention с освобождённым lease, затем активировать guarded AJ compaction и проверить её фактический отчёт.

## Хранение и границы

- Maintenance32 подготовлен и независимо проверен: core **`a343764f`**, observer **`5df222eb`**, **20/20** targeted tests. Exact owner `46046207658 / attempt1 / aa0d0c0b / B9`; старый owner31 с тем же runtime отвергается. Девять core paths побайтово прежние. После rollback32 код остаётся локальным; observer32 не запускать. Markers отсутствуют, REG pins **c6/a5** не изменены.
- Исторические A/B/C witnesses не переписывать. Рабочий AJ DELETE запрещён; compaction использует conditional PUT и уменьшает logical payload, не доказывает физическое освобождение host disk. Ни один observer не применять к откатившемуся или отменённому выпуску.
- AJ — только Япония: реальные запросы посетителей и ограниченный кэш, без дампа/зеркала; fresh30мин, stale fallback строго <7суток с исходной датой. Принятый Китай **`gen_china_45875678028_1`**, pricing **`64c6338e0db23c8999096bceefbf113c0136fe15`**, формулы, энциклопедия и редакторские сведения сохраняются.
- [Подробные bindings, история попыток, ограничения доказательств и хэши артефактов](../operations/2026-11-27-japan-directory-completion.json). Отмена31/Verify62 произошла до build/host; Verify63 диагностировал error-body ожидание, исправленное и проверенное в64. Их результаты не переписываются.
