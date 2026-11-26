# Текущий шаг

Обновлено: 26.11.2026, 07:27, Asia/Krasnoyarsk. Текущий статус заменяется, история сюда не дописывается.

## Поручение

Закрыть фото Китая, первое предварительное PW и актуализацию разрешённого кэша Японии, затем продолжить рынки. Разрешение включает проверку и публикацию без повторного согласования. Полный дамп AJ, подмена visitor IP, изменение формул и чужих рыночных данных запрещены.

## Подтверждено на сайте

- Утренняя проверка 26.11 в 06:50: публичный health HTTP 200, runtime `d536c1547c4d82a339ed68ced7d8503f09b6810b`, calculation version `4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90`. [Утренние public observations](../operations/2026-11-26-morning-public-readonly.json) также фиксируют один GET главной в 07:23: HTTP 200, полный HTML 908 796 байт, без `$RX(`, 11,8913 с из проверяющей среды. Это не browser acceptance и не аудит всех карточек.
- [China daily №45655051136](https://github.com/jeep-jim/AvtoCena/actions/runs/45655051136) принят 26.11 в 02:24: `completed=true`, `published=true`, `status=accepted`. Текущее поколение `gen_china_45655051136_1`: 279 450 допущенных автомобилей; источник наблюдался 26.11 в 00:34:57, курс/расчёты зафиксированы в 00:36:54. Runtime/image приложения остались прежними; lease освобождён.
- [Проверка архива №45685336351](https://github.com/jeep-jim/AvtoCena/actions/runs/45685336351) вычислила SHA256 фактических ZIP bytes и прочитала оба отчёта: источник обновлён от принятого `gen_china_45369451603_1`, `supplierLatestVerified=true`, изменения формул/энциклопедии/других рынков и сборки приложения равны нулю. Manifest B: `6711203fb59a70c99cda3c725eb4ee70654142b1871b0784516209d2903c0b8d`.
- [Диагностика после daily №45685336506](https://github.com/jeep-jim/AvtoCena/actions/runs/45685336506): новая B и предыдущая A приняты и mounted, работают на прежнем image `sha256:f36ebf373120f0a520d2c1af75ff395fba14383e9955c348193eac5e70846009`; host lock свободен. Retention/hostCleanup завершены, `pending=0`; удалений нет, поскольку A сохранена для отката.
- Контрольный China-only запрос Hyundai Elantra / Новокузнецк / 2022–2023 / 1,65–1,75 млн / до 70 тыс. км в 07:01: HTTP 200, B, 57 результатов, 24 карточки. SHA256 `JSON.stringify(items)` — `9da62b332e22e5164a5d3892f3bccee78aaeb25862e3aec9780f711a312490b6`, совпадает с [проверкой 02:31 №45685881373](https://github.com/jeep-jim/AvtoCena/actions/runs/45685881373).

## Фотографии: код проверен, публикация не принята

- [Исходник `36d707bc`](https://github.com/jeep-jim/AvtoCena/commit/36d707bcb599e861918df411e40d8947074f0430) меняет относительно d536 только три photo-компонента/помощника и три теста. Японские readers/cache/search/power semantics и защищённые расчётные файлы остаются d536.
- [CI №45669876181](https://github.com/jeep-jim/AvtoCena/actions/runs/45669876181): 611 controller/contract тестов, 301 тест приложения из 40 файлов, typecheck, recovery-clock и все 6 photo browser scenarios прошли. Test-only compatibility patch не изменён; исходный runtime восстановлен точно.
- [Выпуск №45686183272](https://github.com/jeep-jim/AvtoCena/actions/runs/45686183272), controller `b6ae6d20`, завершился в 02:50 с `china_host_server_speed_failed`: `published=false`, `status=failed`, `leaseReleased=true`, `retentionPreserved=true`. Отказ произошёл до переключения сайта и до live photo browser gate.
- Новый образ `sha256:2e6693575faf62d893cf546a72c81f02cbfe3ffd02746a74da30ce23bfb98753` и archive roundtrip прошли. Проверка ёмкости перед staging: 27 732 930 560 свободных байт при требовании 16 448 370 076; нехватка места этой попыткой не зафиксирована. Семь файлов B на хосте — 12 607 910 031 байт.
- [Сохранённая диагностика №45726343372](https://github.com/jeep-jim/AvtoCena/actions/runs/45726343372) проверила exact36/b6/B, PLAN и закреплённые исходники gate/baseline: `/api/health` и `/api/leads` прошли, затем `/` завершился `IncompleteRead` через 31,1338 с; exit code 1, rejectedSamples 0. Причина неполного ответа ещё не установлена. Это функциональный отказ, а не доказанное превышение числового порога. Gate для диагностики не перезапускался.
- Оба catch-слоя теперь сохраняют только повторно проверенные `serverSpeed`/`homePhaseTiming`; timing связан с runtime/nonce. Исходная ошибка, rollback/lease и функциональные gates сохранены. [CI опубликованного контроллера №45727328117](https://github.com/jeep-jim/AvtoCena/actions/runs/45727328117) прошёл: 643/643 controller/contract, 301/301 тест приложения, typecheck, recovery-clock и все 6 photo browser scenarios; frozen hashes проверены, exact runtime восстановлен. Это исправление диагностики, не исправление неполного ответа главной.

## Диск

- [Утренняя проверка №45726343372](https://github.com/jeep-jim/AvtoCena/actions/runs/45726343372), 26.11 07:07: свободно 26 483 691 520 байт — 24,6649 ГиБ из 95,8484 ГиБ; занято 74,27%. Health HTTP 200, прежний runtime и calculation version; host lock свободен. Новых запросов поставщикам или изменений данных этой диагностикой не выполнялось.
- Причина исходного переполнения: [неудачный выпуск №45621910693](https://github.com/jeep-jim/AvtoCena/actions/runs/45621910693) оставлял копии поколения, журнал подтвердил `no space left on device`. Проверенными очистками удалены две пары ненужных баз; [отдельная очистка №45634151105](https://github.com/jeep-jim/AvtoCena/actions/runs/45634151105) удалила 12 неиспользуемых образов, сохранив контейнеры и защищённые версии.
- Проверки места действуют до staging, перед копированием/загрузкой Docker и при daily transfer/decode. Storage proof учитывает content и unpacked snapshots, PLAN сохраняет 2 ГиБ рабочего запаса.
- Автоматическая очистка подтверждена и для последней попытки36 (`2ebacfe67f5b5ad6`): удалены 7 собственных файлов общим логическим объёмом 12 866 426 075 байт; images/directories deleted 0; `completed=true`, `protectedDeploymentsPreserved=true`, связи attempt/PLAN/rollback совпали. Cleanup receipt SHA256 `4488f9fc79ce54859d92a952f73426973e9e3df7555e0ba3daee5b126570f2da`. Принятые A и B остаются mounted; candidate снят. Свободное место не использовалось как замена квитанции.

## Расписание и Япония

- China cron остаётся 21:00 Asia/Krasnoyarsk (`0 14 * * *`). [Первый реальный schedule №45717710874](https://github.com/jeep-jim/AvtoCena/actions/runs/45717710874) создан 26.11 в 05:59, в 06:01 завершён `not_due`, `published=false`, `sourcePrepared=false`: уже принятое B сохранено, lease освобождён, отложенной очистки нет. Причина позднего создания run не установлена; устойчивость расписания ещё не доказана.
- Контроллер исправлен: сравниваются суточные окна с началом 21:00, а не календарные даты. Источник B после полуночи закрывает предыдущий цикл; повтор утром не нужен, 26.11 в 21:00 — `due=true`. 34/34 связанных daily теста и все 643 controller/contract теста прошли. Cron, manual trigger, clock guards, lease/CAS, runtime и формулы не менялись. Это не исправляет неустановленную причину позднего создания GitHub schedule и не доказывает стабильность будущих запусков.
- Японские первое PW и неизвестная мощность остаются непринятыми. [Совместный выпуск №45647364912](https://github.com/jeep-jim/AvtoCena/actions/runs/45647364912) откатился на `stale=true`, `partial=true` в POWER sample до проверки PW/UI. Последний отдельный [public power-запрос 00:11](../operations/2026-11-26-japan-power-readonly.json) также не подтвердил свежесть. Точная причина исторического отказа не установлена; поздние чужие failure records её не доказывают.

## Следующий шаг

1. Проверить оставшиеся сохранённые home-phase/процессные свидетельства exact36/b6/B для причины `IncompleteRead` на главной. Не связывать поздние AJ failure records с этой исторической ошибкой без доказательства. CI опубликованных controller исправлений прошёл; следующий шаг определяется сохранёнными свидетельствами отказа.
2. Исправить установленную причину и завершить photo-only выпуск на текущем принятом B с настоящей браузерной приёмкой и проверкой очистки; source/image/baseline/rollback bindings сохраняются. Не ослаблять приёмку и не повторять выпуск вслепую.
3. После принятия фото перевязать отдельный Japan release к фактическому retained runtime. Не объявлять свежесть AJ или первое PW рабочими без их приёмки. Затем продолжить остальные рынки по очереди.

Не запускать пересекающиеся выпуски, старый общий publisher или новый сбор Китая ради UI. Не удалять mounted/current/rollback данные. Не называть зелёный CI, ручной daily либо schedule/not_due доказательством завершённой публикации или устойчивого расписания.
