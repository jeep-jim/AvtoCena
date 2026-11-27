# Текущий шаг

Checkpoint: **28.11.2026, Asia/Krasnoyarsk**. Работа продолжается только по Японии и затронутому общему пути главной.

## Фактическая публикация

- [Выпуск №30](https://github.com/jeep-jim/AvtoCena/actions/runs/46032025653) завершился **rolled_back**: controller **9828aa3d**, trigger **1c7d35ef**, runtime **d6357672**. Восстановление/retention/lease release подтверждены, exact failed image удалён. Fresh API и plain страницы **24+24** прошли; остановка **stability_brand_directory_desktop / japan_browser_stability_brand_directory_rows**, timeout=false. Ответ metadata HTTP200/stale=false, raw counts не записаны; UI показал 6 реальных fallback марок и «Повторить». Model journey ещё не запускался.
- [Verify №61](https://github.com/jeep-jim/AvtoCena/actions/runs/46031918122) **PASS:1582/1582 controller,539/539 native,typecheck**, все обязательные fixtures; model controls **2/2 actual Chromium cases** и legacy **8/8**. Те же новые cases прошли перед host в выпуске №30.
- [Выпуск №29](https://github.com/jeep-jim/AvtoCena/actions/runs/46025367220) завершился **rolled_back**: controller **ab96176c**, trigger **ee8ac769**, runtime **d6357672**. Восстановление/retention/освобождение lease подтверждены; exact failed image удалён. [Verify №60](https://github.com/jeep-jim/AvtoCena/actions/runs/46025187067): **8/8 browser cases**, **1563/1563 controller**, **539/539 native**, typecheck и обязательные fixtures PASS.
- Исправленный legacy-переход №29 **прошёл live**: exact308→canonical200, probe закрыта,24fresh Mazda3 rows, model/city/UI/API совпали, JS errors0. Следующая остановка — **stability_model_selection**, timeout=true; screenshot показывает закрытую «Любая марка» без выбранной Mazda. Точное действие не записано. Проверка сразу кликает SSR-кнопку, не ожидая существующий interactive marker; источник уже содержит disabled/aria-busy readiness у скрытой advanced-кнопки.
- [Выпуск №28](https://github.com/jeep-jim/AvtoCena/actions/runs/46018937645) для **d6357672** завершился **rolled_back**: retention сохранён, восстановление подтверждено, lease освобождён. Политика **japan-functional-observed-timing-v1** реально применена; broad server benchmark не выполнялся, speedPassed=null. [Exact CI №59](https://github.com/jeep-jim/AvtoCena/actions/runs/46017976636): **1561/1561 controller**, **539/539 native**, typecheck и все browser fixtures PASS.
- Собственная live-проверка №28 подтвердила свежесть, UI/API, 44 марки на mobile/desktop, страницы 24+24, порядок мощности, petrol+city, редактирование мощности/расчёт, видимость Японии на главной и в каталоге. Остановка — **stability_legacy_mazda_three**, generic browser error, timeout=false. Первый точный 308 redirect подтверждён; следующий canonical navigation завершился ошибкой до legacy API. Raw exception не сохранён, конкретная причина ещё не доказана. Model/combined/related/vehicle gates не завершены.
- Failed candidate image №28 удалён по exact terminal proof: один образ, измеренное изменение свободного места **1,191,768,064 B**. Это доказательство относится только к образу d635 этого запуска.
- Последняя подтверждённая принятая версия — **a5ca426eec2663eb17c2df69fe2bfed46e2b8740**, Китай C.
- [Выпуск №27](https://github.com/jeep-jim/AvtoCena/actions/runs/46010255614), controller **0a044170**, runtime **a4f23e648d3de2a8a23c9a16942a286b91bb39b4**, завершился ошибкой **china_host_server_speed_failed**. Retention сохранён, lease освобождён.
- Candidate остановлен на loopback speed gate **до reserve/activate/switch**. Новая публичная browser acceptance не запускалась. Это следует из точного порядка controller/host, а не только из published=false.
- Health и leads прошли за 0.0115/0.0113 с; главная не завершила ответ за 90.2564 с. В её trace snapshotProjection=81.270 с, snapshotPrepared=84.9215 с; эти вложенные/параллельные времена не суммируются.
- Свободного места при admission было 49,058,750,464 B при требовании 16,521,809,474 B. Артефакт не содержит CPU/RSS/I/O измерений и не доказывает завершение cleanup failed candidate; отдельного удаления его Docker image этот путь не выполняет.
- [Точные bindings, CI и отчёт ошибки](../operations/2026-11-27-japan-directory-completion.json).

## Действующее поручение владельца

- После ошибки №27 владелец повторно отменил блокировку Японии по секундам и скорости соседних разделов, включая выпуск кода. Дальнейшее исследование общей скорости/metadata остановлено. Требуется завершить публикацию.
- Новые exact58/59 профили используют **japan-functional-observed-timing-v1**: собственная функциональная browser acceptance Японии, сохранённые China bytes/oracle, реальные timing observations; **speedGateRequired=false, speedPassed=null**. Исторические измерения и старые receipts не переписываются.

## Подготовленные исправления и проверка

- Новый source **b9e9122b75f4e588088d0241476b18df7f047d96** сохраняет все японские исправления d635/a4: полный источник марок/моделей, сохранение видимых марок и настоящий повтор при пустом/stale/error справочнике, порядок известной/неизвестной мощности, заполнение страниц, транспортную политику и точную source identity.
- Длинное пояснение мощности удалено также из японских блоков общего каталога и фильтруемой главной; сведения на карточках сохранены.
- [Exact CI №58](https://github.com/jeep-jim/AvtoCena/actions/runs/46009412568) для controller **dbc7c00c**: **1551/1551 controller**, **534/534 native**, typecheck и все browser fixtures PASS; справочник **18/18**, pagination **12/12**, город **4/4**. Те же fixtures прошли в выпуске №27.
- Предыдущий runtime d635 имел tree **0ac828876e7e43b952e342a4f499563c54f3fc41**, профиль **58 runtime / 112 pricing paths**. Home isolation: 3 воспроизведённые регрессии на a4; после исправления 36 адресных, полный native **539/539**, typecheck и exact source/pricing proof PASS. Собственные live brand/power/page/detail/city/model проверки и rollback сохранены.
- Ограниченный transient GET retry REG и безопасная диагностическая проекция включены в controller; PUT/CAS/lease semantics сохранены. В №27 прежняя storage transport ошибка не повторилась до достигнутого speed gate.

## Активный следующий шаг

- Source **b9e9122b** опубликован: tree **4e2c36e461416d6db7d0f52753c9a933d626dd5c**, exact **59 runtime / 113 pricing paths**. Полная проверка SHA/tree/binary diff и сохранности pricing прошла; к старому HOME58 добавлен только существующий testpath `tests/ajes-ready-metadata.test.ts`. Исторические profiles/receipts сохранены.
- Воспроизведённый defect unconfirmed empty makes/models исправлен: первая пустая metadata требует точного fresh COUNT=0; старый empty без доказательства не выдаётся fresh, полезные названия не затираются. Запоздавший zero не побеждает более новое положительное наблюдение. Global TTL, LIST, цены и остальные рынки сохранены. Raw brand-counts body №30 отсутствует: точный wire [] этого запуска не объявляется доказанным.
- Source verification: **38/38** адресных тестов; полный native69 files дал **546/557**, остальные11 зависели от отсутствующих sparse reference данных. После материализации точных HEAD blobs оба затронутых файла прошли **25/25**, включая все11; typecheck PASS. Единого чистого полного локального запуска не было; hosted должен подтвердить **557/557**.
- Controller retry **03d98522**: один настоящий dropdown «Повторить» и один независимый rail retry перед прежним strict full-directory proof; fallback не считается полным справочником. Сохранены фактическая hydration, карточки, source aliases, URL/город/выбор и read-only fence. **105/105** адресных controller tests, exact59 scope/host **81/81**, независимые reviews PASS.
- В обоих workflows обязательны **3 actual-runtime retry Chromium cases** до build/host: настоящий mobile dialog, desktop dropdown+rail recovery и отказ persistent empty. Локального Chromium-прогона не было; hosted fixture pending. Прежние legacy8 и model-readiness2 gates сохранены; их предыдущие успешные runs описаны выше.
- Следующее действие — публикация reviewed controller и отдельного marker, затем фактическая полная приёмка. Не возвращать общий скоростной барьер и не запускать metadata/performance исследования как условие выпуска. До принятого результата новый source не считается установленным.

## Хранение и сохранённые границы

- AJ — только Япония: реальные запросы посетителей и разрешённый ограниченный кэш, без дампа/зеркала. PW трактуется как целое л.с. по уточнению 26.11; неизвестная мощность явно обозначается.
- Принятые данные Китая **gen_china_45875678028_1**, pricing **64c6338e0db23c8999096bceefbf113c0136fe15**, формулы, энциклопедия и редакторские сведения сохраняются.
- Maintenance перенесён на ee8ac в локальные **8e793ed6** и **0c7135c5**. Core/REG paths побайтово прежние, новый observer №29 проверен **20/20** необходимыми tests и independent review. **Не опубликован и не активирован.** Старые observers №27/28 не включены; №29 завершился rollback, поэтому этот observer не разрешает обслуживание и не запускается.
- Maintenance №30 подготовлен отдельно: core **bd58bf18** побайтово прежний, exact observer **d298a700** связан с run **46032025653 /1/1c7d35ef**. **20/20** адресных tests и independent review PASS; markers не созданы, обслуживание не опубликовано и не активировано. REG pins остаются прежними до фактического принятого состояния. №30 завершился rollback; этот observer не запускается и должен быть перенесён на фактически принятый выпуск.
- До автоочистки нужны принятый новый runtime и свежая фактическая пара current/rollback. Исторические A/B/C witnesses не переписывать; рабочий AJ DELETE запрещён. Compaction уменьшает logical payload через conditional PUT, не доказывает физическое освобождение host disk.
