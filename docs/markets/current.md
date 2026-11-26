# Текущий шаг

Обновлено: 26.11.2026, 08:03, Asia/Krasnoyarsk. Статус заменяется, история сюда не дописывается.

## Поручение и границы

Закрыть фото Китая, первое предварительное PW и неизвестную мощность Японии с подтверждением свежести, затем продолжить рынки. Проверка и публикация уже разрешены. Китай принят владельцем; разрешён точечный фото-ремонт и совместимый японский выпуск. Формулы, энциклопедию, ручные данные, CRM/auth и чужие рынки не менять. Полный дамп AJ, подмена visitor IP и прежний общий China publisher запрещены. Основные правила — [contract.md](contract.md) и [china.md](china.md).

## Что принято и работает

- Production runtime `d536c1547c4d82a339ed68ced7d8503f09b6810b`, image `sha256:f36ebf373120f0a520d2c1af75ff395fba14383e9955c348193eac5e70846009`. Health в 07:57 — HTTP 200; calculation version `4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90` не менялась.
- [China daily №45655051136](https://github.com/jeep-jim/AvtoCena/actions/runs/45655051136) принят 26.11 в 02:24: `completed/published=true`, `status=accepted`, lease освобождён. Поколение B — `gen_china_45655051136_1`, manifest `6711203fb59a70c99cda3c725eb4ee70654142b1871b0784516209d2903c0b8d`; 279 450 допущенных автомобилей. Источник наблюдался в 00:34:57, pricing snapshot — 00:36:54. Приложение не пересобиралось; формулы и другие рынки не менялись. [Проверка фактического архива и двух отчётов](https://github.com/jeep-jim/AvtoCena/actions/runs/45685336351) подтверждает дельты от принятого A и `supplierLatestVerified=true`.
- [Утренние public GET observations](../operations/2026-11-26-morning-public-readonly.json): China Hyundai Elantra / Новокузнецк / 2022–2023 / 1,65–1,75 млн / до 70 тыс. км в 07:01 — B, 57 результатов, 24 карточки; SHA items совпал с 02:31. Главная в 07:23 — полный HTTP 200 без `$RX(`, 908 796 байт, 11,8913 с из проверяющей среды. Это отдельные наблюдения, не аудит всех карточек или browser acceptance.

## Диск и защита

- [Последняя проверка №45732403938](https://github.com/jeep-jim/AvtoCena/actions/runs/45732403938), 07:57: свободно 26 478 452 736 байт — **24,6600 ГиБ из 95,8484 ГиБ**, занято 74,27%. Host lock свободен, retained health/ingress связаны до и после чтения.
- Исходное переполнение вызвано копиями поколений неудачных выпусков; журнал подтверждал `no space left on device`. Проверенными очистками удалены ненужные копии и [12 неиспользуемых образов](https://github.com/jeep-jim/AvtoCena/actions/runs/45634151105). Проверки ёмкости действуют до staging/copy/image и при transfer/decode, учитывают content + unpacked snapshots и 2 ГиБ запаса.
- [Проверка №45726343372](https://github.com/jeep-jim/AvtoCena/actions/runs/45726343372) подтвердила cleanup последней попытки36: 7 собственных файлов, 12 866 426 075 логических байт, `completed/protectedDeploymentsPreserved=true`, attempt/PLAN/rollback bindings совпали. Images/directories deleted 0. Принятые B и предыдущая A остаются mounted; свободное место не заменяет проверку квитанции.

## Фото: код проверен, публикация не принята

- Runtime-кандидат `36d707bcb599e861918df411e40d8947074f0430` отличается от d536 ровно тремя photo app-файлами и тремя тестами. Code scope `catalog-photo-recovery-v1`; японские readers/cache/PW и расчётные файлы остались d536. [CI контроллера №45727328117](https://github.com/jeep-jim/AvtoCena/actions/runs/45727328117) прошёл: 643 controller/contract, 301 app tests, typecheck, recovery-clock и 6 browser photo scenarios. Frozen baseline hashes проверены, runtime после test-only compatibility patch восстановлен точно.
- [Выпуск №45686183272](https://github.com/jeep-jim/AvtoCena/actions/runs/45686183272), controller b6ae6d20, завершился в 02:50 с `china_host_server_speed_failed`, `published=false`, `leaseReleased=true`. Новый image `sha256:2e6693575faf62d893cf546a72c81f02cbfe3ffd02746a74da30ce23bfb98753` и archive roundtrip прошли. Capacity admission прошёл; нехватка диска в этой попытке не зафиксирована. Отказ произошёл до switch и live browser gate.
- [Сохранённые доказательства](../operations/2026-11-26-photo-attempt-readonly.json): startup ready через 528,0845 с / 89 health-попыток; health/leads прошли, затем `/` дал `IncompleteRead` через 31,1338 с. Docker `die`, exit0, произошёл за 225 799 719 нс до speed JSON; `destroy` — через 33 427 249 нс после него. Этот die не вызван последующим stop из cleanup данного host. Момент самой HTTP-ошибки отдельно не записан; сигнал и причина завершения не установлены.
- В точном 63-секундном journal-срезе container log пуст; три записи служб дали shim disconnect/cleanup и одну нераспознанную строку, без связанного TaskExit/PID. Текущий retained имеет класс `node_other`, без NODE_OPTIONS/preload и трёх Next signal/profile ENV flags. Entrypoint `['node']` подтверждён сравнением SHA256; Cmd остаётся невыведенным/неустановленным (SHA256 `18af02283c0d1ec4727f1613c7ccb8d02c5010693f8974715930ed2a962769db`). Это reconstruction по тому же retained ID, не сохранённый candidate snapshot. Нельзя объявлять причиной OOM, сигнал, таймер, S3 или AJ по этим данным.
- [Правка контроллера d8de9a59](https://github.com/jeep-jim/AvtoCena/commit/d8de9a59ad416303238afbbbd9d55a59a59b3273) сохраняет проверенные `serverSpeed/homePhaseTiming` через оба catch-слоя. Она не меняет gate/rollback/lease и не исправляет причину остановки. Последний readonly reader прошёл 76 целевых тестов; новых app releases утром не было.

## Расписание и Япония

- Cron — ежедневно 21:00 Asia/Krasnoyarsk (`0 14 * * *`). Ночное принятое B было ручным push-запуском. [Первый реальный schedule №45717710874](https://github.com/jeep-jim/AvtoCena/actions/runs/45717710874) создан в 05:59, завершён `not_due`: нового сбора/публикации нет, B и lease в порядке. Причина задержки GitHub неизвестна, стабильность расписания ещё не доказана.
- Исправление окна опубликовано в d8de9a59: сравниваются суточные окна от 21:00 по `sourceObservedAt`. Ночное B закрывает предыдущий цикл, утром повтор не нужен, 26.11 в 21:00 — due. 34/34 связанных daily теста и CI выше прошли; cron/manual/clock guards/lease/CAS не менялись. Это не доказательство своевременного будущего запуска.
- Первое PW и неизвестная мощность Японии не приняты. [Совместный выпуск №45647364912](https://github.com/jeep-jim/AvtoCena/actions/runs/45647364912) откатился на `stale/partial` в POWER до PW/UI gate. Последний отдельный [public power-запрос 00:11](../operations/2026-11-26-japan-power-readonly.json) свежесть также не подтвердил. Поздние failure records других запросов не доказывают причину этого отказа.

## Следующий шаг

1. Установить унаследованный Cmd и сохранить проверяемые server/lifecycle failure observations до cleanup при следующем контролируемом воспроизведении. Исторический журнал не установил причину exit0; повторять тот же выпуск без новых свидетельств нельзя. Не менять frozen baselines и функциональную приёмку.
2. Принять photo-only выпуск на текущем B с настоящими browser gates. Сохранять source/image/generation/rollback bindings; не запускать новый сбор Китая ради UI и не удалять mounted/current/rollback данные.
3. После принятия фото закрепить фактический retained runtime в base china-serving-plan, затем готовить отдельный Japan runtime/образ с новым SHA. Старый combined4302 image не переименовывать. Подтвердить свежесть и PW/unknown-power до приёмки, затем продолжить остальные рынки.
