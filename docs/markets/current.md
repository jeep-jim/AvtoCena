# Текущий шаг

Checkpoint: **27.11.2026, Asia/Krasnoyarsk**. Работа продолжается только по Японии и затронутому общему пути главной.

## Фактическая публикация

- Последняя подтверждённая принятая версия — **a5ca426eec2663eb17c2df69fe2bfed46e2b8740**, Китай C.
- [Выпуск №27](https://github.com/jeep-jim/AvtoCena/actions/runs/46010255614), controller **0a044170**, runtime **a4f23e648d3de2a8a23c9a16942a286b91bb39b4**, завершился ошибкой **china_host_server_speed_failed**. Retention сохранён, lease освобождён.
- Candidate остановлен на loopback speed gate **до reserve/activate/switch**. Новая публичная browser acceptance не запускалась. Это следует из точного порядка controller/host, а не только из published=false.
- Health и leads прошли за 0.0115/0.0113 с; главная не завершила ответ за 90.2564 с. В её trace snapshotProjection=81.270 с, snapshotPrepared=84.9215 с; эти вложенные/параллельные времена не суммируются.
- Свободного места при admission было 49,058,750,464 B при требовании 16,521,809,474 B. Артефакт не содержит CPU/RSS/I/O измерений и не доказывает завершение cleanup failed candidate; отдельного удаления его Docker image этот путь не выполняет.
- [Точные bindings, CI и отчёт ошибки](../operations/2026-11-27-japan-directory-completion.json).

## Действующее поручение владельца

- После ошибки №27 владелец повторно отменил блокировку Японии по секундам и скорости соседних разделов, включая выпуск кода. Дальнейшее исследование общей скорости/metadata остановлено. Требуется завершить публикацию.
- Новый exact58 профиль использует **japan-functional-observed-timing-v1**: собственная функциональная browser acceptance Японии, сохранённые China bytes/oracle, реальные timing observations; **speedGateRequired=false, speedPassed=null**. Исторические измерения и старые receipts не переписываются.

## Подготовленные исправления и проверка

- Новый source **d6357672787a73c8e62e6f895f3c4cac5dc77211** сохраняет все японские исправления a4: полный источник марок/моделей, сохранение видимых марок и настоящий повтор при пустом/stale/error справочнике, порядок известной/неизвестной мощности, заполнение страниц, транспортную политику и точную source identity.
- Длинное пояснение мощности удалено также из японских блоков общего каталога и фильтруемой главной; сведения на карточках сохранены.
- [Exact CI №58](https://github.com/jeep-jim/AvtoCena/actions/runs/46009412568) для controller **dbc7c00c**: **1551/1551 controller**, **534/534 native**, typecheck и все browser fixtures PASS; справочник **18/18**, pagination **12/12**, город **4/4**. Те же fixtures прошли в выпуске №27.
- Новый runtime tree **0ac828876e7e43b952e342a4f499563c54f3fc41**, профиль **58 runtime / 112 pricing paths**. Home isolation: 3 воспроизведённые регрессии на a4; после исправления 36 адресных, полный native **539/539**, typecheck и exact source/pricing proof PASS. Собственные live brand/power/page/detail/city/model проверки и rollback сохранены.
- Ограниченный transient GET retry REG и безопасная диагностическая проекция включены в controller; PUT/CAS/lease semantics сохранены. В №27 прежняя storage transport ошибка не повторилась до достигнутого speed gate.

## Активный следующий шаг

- Лишняя зависимость home fallback от общего all projection устранена двумя source-файлами; generation binding, подсчёт, порядок и цены сохранены. Измеренного ускорения production не заявлять.
- Controller/host policy собрана и независимо reviewed: 387 адресных проверок, browser policy 86, exact scope helpers 7. Все обязательные локальные controller test files проверены: 1542 + 19 после восстановления отсутствующего reference JSON в sparse checkout, нерешённых ошибок нет. Следующий шаг: exact hosted CI → один выпуск → собственная функциональная live acceptance Японии.
- Не возвращать общий скоростной барьер, не запускать новые metadata/performance исследования как условие выпуска. До принятого результата новый source не считается установленным.

## Хранение и сохранённые границы

- AJ — только Япония: реальные запросы посетителей и разрешённый ограниченный кэш, без дампа/зеркала. PW трактуется как целое л.с. по уточнению 26.11; неизвестная мощность явно обозначается.
- Принятые данные Китая **gen_china_45875678028_1**, pricing **64c6338e0db23c8999096bceefbf113c0136fe15**, формулы, энциклопедия и редакторские сведения сохраняются.
- Maintenance перенесён на 0a в локальные **c56dc2cf** и **3c58d239**, проверен 63/63 и 16/16 тестами, независимо reviewed. **Не опубликован и не активирован.** Observer 3c привязан к не принятому №27; выдавать его за successful accepted proof нельзя.
- До автоочистки нужны принятый новый runtime и свежая фактическая пара current/rollback. Исторические A/B/C witnesses не переписывать; рабочий AJ DELETE запрещён. Compaction уменьшает logical payload через conditional PUT, не доказывает физическое освобождение host disk.
