# Ограниченное сокращение просроченных ответов AJ

Этот controller-путь сокращает содержимое уже сохранённого японского кэша. Он не загружает каталог AJ, не обращается к поставщику и не пересобирает приложение. Наличие исходника, workflow или успешных offline-тестов не означает, что рабочий кэш уже обработан. Фактический запуск, проверенные счётчики и принятие результата записываются отдельно в `docs/markets/current.md`.

## Основание и границы

В [синтетической проверке 45950312191](https://github.com/jeep-jim/AvtoCena/actions/runs/45950312191) запрос PUT с прежним ETag **без кавычек** получил HTTP 412, а новая версия тестового объекта сохранилась: `currentObjectConditionalPutVerified=true`. Условный DELETE с прежним ETag вернул HTTP 204 и не сохранил тестовый объект: `currentObjectConditionalDeleteVerified=false`; matching DELETE не выполнялся. Это доказательство относится к проверенному объекту и формату заголовка, не ко всем возможностям S3.

Рабочие объекты AJ обрабатываются только через **условный PUT с bare `If-Match`**. Реальный cache DELETE запрещён на общей границе сетевого доступа. Перед каждой ограниченной операцией выполняется новая синтетическая проба CAS на собственном непредсказуемом ключе; старого отчёта для разрешения записи недостаточно. DELETE допускается только для этого собственного синтетического ключа вне рабочего кэша, внутри прежней ограниченной пробы.

Допустимы только три существующих логических префикса в закреплённом REG staging prefix:

- `catalog/partner-cache/ajes/stats/`;
- `catalog/partner-cache/ajes/main/`;
- `catalog/partner-cache/ajes/queries/`.

Списки и тела берутся из собственного REG-хранилища. Энциклопедия, ручные характеристики, CRM, объявления других рынков, активные поколения и настройки bucket не изменяются. `accepted`, `intent` и `lease` Китая используются только как существующее доказательство завершённой публикации; в эти документы операция не пишет.

## Что считается просроченным

Возраст ответа должен быть **не меньше 7 дней по исходному `observedAt`**. Это соответствует существующему пределу резервного показа: строго меньше семи дней. `LastModified`, дата чтения и время checkpoint не подменяют дату поставщика. Время начала ограниченной операции фиксирует порог для всех её проверок.

Обрабатываются только распознанные сохранённые AJ envelopes. Неизвестная структура, неверная дата, будущая дата, неоднозначное содержимое или превышение разрешённого размера означают пропуск, а не разрешение удалить данные.

- Просроченный одиночный ответ карточки заменяется JSON `null`.
- В query envelope отдельно проверяются текущая запись и сохранённые `previous`. Просроченные записи удаляются из envelope; ещё допустимые записи сохраняют свои hashes, исходные JSON-значения и `observedAt`.
- Если допустимых записей не осталось, содержимое становится JSON `null`.
- Свежая запись, возникшая между GET и PUT, защищена ETag. HTTP 409/412 означает конкурирующее изменение; повторной безусловной записи нет.

Технический ключ после записи `null` **остаётся**. `logicalPayloadBytesReduced` — разница длины подтверждённых тел до и после PUT, а не измеренное освобождение диска сервера, не число удалённых ключей и не подтверждение физического освобождения места backend. История версий не перечисляется. Операция допускается только при подтверждённом `versioning=never_enabled`; изменение этого состояния останавливает запись.

## Guard принятой публикации

Entry создаёт `createJapanCachePublicationFence` через существующий `createChinaStateStorage`. Все его ACL и state GET проходят через тот же общий bounded fetch, что и обработка кэша.

Перед началом допускаются только `inspectChinaPublicationState(...).status=resolved`, `intent.status=committed`, отсутствие pending reservation и проверенные current **и** rollback references с действительными host acceptance proofs. Отсутствующая версия возврата, pending/aborted intent, конфликт документов или недоступное доказательство дают deferred.

Используется текущий `china-state.mjs`, который проверяет и обычный receipt, и новый Japan receipt с политикой `japan-functional-observed-timing-v1`, `speedGateRequired=false` и `speedPassed=null`. Отсутствие speed veto не заменяет функциональную приёмку. Offline-сценарий создаёт новый code-update через реальные `reserve/commit` validators, затем пропускает его через observer и динамический maintenance guard; подмена null на выдуманный speed success или изменение publication observation закрывает guard. Это проверка формата и поведения на синтетическом состоянии, а не свидетельство успешного рабочего выпуска.

Любая lease со `status=held`, в том числе с истёкшей датой, означает busy/deferred. Эта операция не приобретает lease, не продлевает TTL, не снимает чужую блокировку и не делает вывод об успешном восстановлении по времени.

Snapshot читается в порядке `lease → accepted → intent → lease`. Две lease observations должны совпасть. Перед **каждым реальным cache PUT и каждым checkpoint PUT** повторяются чтения и проверяется неизменность исходных `found` / ETag / SHA256 для всех трёх документов. После первого отказа guard остаётся закрытым до завершения этого запуска. Общая GitHub concurrency не допускает пересечения с выпуском приложения или обновлением Китая; CAS защищает сам изменяемый cache object от параллельного writer runtime. Отдельной транзакции между разными S3-ключами этот путь не объявляет.

## Лимиты одной операции

| Ресурс | Максимум |
| --- | --- |
| Все S3-запросы, включая state guard и canary | 500 |
| Общее время сетевой операции | 120 секунд |
| Один запрос | 8 секунд |
| Сумма отправленных и полученных тел | 32 MiB |
| Попытки PUT рабочего кэша | 100 |
| Страницы LIST | 8 страниц, до 100 ключей каждая |
| Тело отдельной карточки | 2 MiB |
| Query envelope / metadata response | 256 KiB |
| Приватный checkpoint | 64 KiB |
| Публичный sanitized report | 32 KiB |
| GitHub job | 10 минут, включая подготовку и offline-проверки |

Это пределы, не обещание обработать 100 объектов. Guard имеет приоритет над размером партии. Если бюджет закончился раньше, результат остаётся частичным, а следующий запуск продолжает с подтверждённого checkpoint. Сетевых повторов, обхода лимита или ослабления guard ради полной партии нет.

## Приватный checkpoint и продолжение

Checkpoint расположен по фиксированному логическому ключу `catalog/operations/ajes-cache-compaction/v1/checkpoint.json`. Он содержит версию политики, сведения об исходной активации, номер цикла, текущий префикс, continuation token, ограниченный список ключей страницы и позицию внутри неё. Он сохраняется условным PUT, проверяется чтением обратно и не публикуется в artifact.

Позиция сохраняется при переходах между страницами/префиксами и после каждых восьми обработанных записей. При обрыве остаётся последний подтверждённый checkpoint: часть страницы может быть прочитана повторно, но каждое тело снова проверяется и записывается только относительно его текущего ETag. Неопределённый результат записи не считается подтверждённым сокращением; счётчик пополняется после сверки сохранённого тела. Изменение cursor другим запуском приводит к остановке, а не к перезаписи чужого прогресса.

Завершение одного прохода означает достижение конца перечисленных префиксов в этом цикле. Это не согласованный полный снимок постоянно изменяемого кэша. Следующая разрешённая операция начинает новый цикл с теми же ограничениями, чтобы проверять записи, которые позднее достигли предельного возраста.

## Активация и workflow

Файл `.github/workflows/japan-cache-compaction.yml` публикуется только вместе с проверенным controller-кодом, после подтверждения terminal outcome активного японского выпуска. Если принятая публикация не соответствует guard, операция остаётся deferred.

Первая реальная операция требует **отдельного marker-only push** в `main` после публикации и проверки исходника. Marker в этой доработке не создаётся. Его единственный родитель должен быть уже опубликованным проверенным tip `main`, а diff — содержать только `.github/market-runs/japan-cache-compaction.json`. Проверка использует существующий `verifyReadonlyInvocation`; push source-кода и marker одним переходом, force push, merge marker, повтор job или чужая ветка не допускаются.

Шаблон marker ниже намеренно содержит недействительный placeholder:

```json
{
  "version": 1,
  "operation": "japan-cache-compaction-v1",
  "approvedSourceSha": "<REVIEWED_CONTROLLER_SHA>"
}
```

После инициализации private checkpoint workflow продолжает обработку по cron **`43 * * * *` UTC**. Это запуск на 43-й минуте каждого часа, без гарантии точного времени исполнения GitHub. До первого marker schedule и manual invocation возвращают `not_initialized`, без synthetic PUT и без записи кэша.

Ручной `workflow_dispatch` предназначен для продолжения уже инициализированной операции. В `expected_controller_sha` передаётся полный проверенный текущий SHA `main`; он должен совпасть с event input, `GITHUB_SHA` и checkout `HEAD`. В executable shell входные значения не подставляются.

Для всех режимов проверяются `GITHUB_ACTIONS=true`, точные repository name/id **jeep-jim/AvtoCena / 1289722938**, `refs/heads/main`, workflow ref, job **compact**, attempt **1**, run ID, event и чистый checkout. Schedule дополнительно требует точную cron-строку из GitHub event; локально созданный marker или произвольный JSON не заменяют этот event. Concurrency — **catalog-next-china**, `cancel-in-progress: false`.

## Проверки и отчёт

До передачи storage credentials workflow проверяет исходные speed baseline hashes, синтаксис entry/core, точный invocation и offline-тесты core, guard, workflow и marker. Он не получает SSH-ключи или AJ credentials, не ставит зависимости и не запускает сборку runtime.

Интеграционный offline-тест проходит через настоящий entry, проверку marker-only git checkout, исходные frozen baselines, core и `createChinaStateStorage`; заменён только внешний S3 transport, время и nonce. Он сверяет общий счётчик запросов и байтов с каждым фактическим обращением mock storage, проверяет восемь state GET перед каждым реальным PUT и продолжение по schedule после ограниченной партии. Отдельный сценарий подтверждает остановку до canary при held lease и отсутствие cache PUT, если accepted publication изменилась после чтения payload. Эти проверки подтверждают локальное поведение кода, а не состояние рабочего bucket.

```bash
node scripts/verify-frozen-speed-baselines.mjs
node --import ./tests/helpers/offline-fetch.mjs --test --test-concurrency=1 tests/catalog-next-japan-cache-compaction.test.mjs tests/catalog-next-japan-cache-compaction-entry.test.mjs tests/catalog-next-japan-cache-compaction-workflow.test.mjs tests/readonly-marker-invocation.test.mjs
```

Единственный artifact — `japan-cache-compaction-report.json`, до 32 KiB, срок хранения 14 дней. Он содержит агрегаты, безопасные коды причины остановки и сведения о проверенном формате CAS. Тела AJ, SQL, visitor IP, credentials, private checkpoint, accepted/intent/lease и host acceptance receipts в artifact не входят. Если entry не получил результат уже начатого core, число его мутаций остаётся неизвестным, а не превращается в ноль.

Для подтверждения реальной работы нужны report конкретного запуска, успешные readback для засчитанных PUT и явный partial/completed status. Пропущенные неизвестные envelopes, необработанный остаток и неподтверждённые записи не скрываются. Ни зелёный CI, ни сокращение логического payload не позволяют написать, что весь старый кэш удалён или физически освобождено место host.

## Точная пара после выпуска 46051339049

Эта версия перенесена на controller `4e62111a5598a7d77304d697a02e8a014d93b798` и его release trigger `a697a7b1c78a4d362134c2c3ab84dc0be5809a4d`. Выпуск №27 (`46010255614`) завершился отказом до активации, а №28 (`46018937645`), №29 (`46025367220`) и №30 (`46032025653`) — rollback. Выпуск №31 (`46040340638`) отменён на этапе offline browser fixture до обращения к host. Выпуск №32 (`46046207658`) завершился rollback после отказа Japan model-selection guard. Их прежние локальные observers не используются как доказательство приёмки. Для №33 созданы отдельные имена observer, workflow, marker и artifact. Никакой marker в этой доработке не создаётся. До фактического принятия №33 и нового наблюдения оба пути обслуживания остаются неактивированными.

`retainedRuntime` в aggregate code-cycle report берётся из плана. Для обновления закреплений REG retention нужен фактический `accepted.current` и `accepted.rollback`, подтверждённый соответствующим завершённым `intent`.

Для этого подготовлен отдельный read-only workflow `.github/workflows/japan-accepted-pair-46051339049-readonly.yml`. Он связан с выпуском **46051339049 / attempt 1**, trigger revision **a697a7b1c78a4d362134c2c3ab84dc0be5809a4d** и runtime **b9e9122b75f4e588088d0241476b18df7f047d96**. Фактические rollback runtime/image и оба generation references берутся только из прочитанного принятого состояния. Уже прошедшая следующая публикация означает несовпадение точного target, а не разрешение использовать старое наблюдение.

После terminal accepted report этого выпуска и публикации проверенного observer его можно вызвать отдельным marker-only push. Это **маркер наблюдения**, не активация compaction или удаления:

```json
{
  "version": 1,
  "operation": "observe-japan-accepted-pair-46051339049",
  "approvedSourceSha": "<REVIEWED_CONTROLLER_SHA>"
}
```

Единственный изменяемый путь такого push — `.github/market-runs/japan-accepted-pair-46051339049-readonly.json`; его родитель должен уже находиться в `main`. Исходник не создаёт этот marker. Также допустим `workflow_dispatch` с точным `expected_controller_sha`. Расписания нет; concurrency остаётся `catalog-next-china`.

Observer выполняет не более **18 GET**: bucket ACL/policy и два последовательных чтения `lease → accepted → intent → lease`. Общий срок — до **120 секунд**, один запрос — до **8 секунд**, каждое тело ограничивает существующий state transport величиной **256 KiB**. Имена ключей закреплены; LIST, PUT, DELETE, SSH, приложение и поставщик недоступны этому пути. До credentials проверяются invocation, frozen baselines и offline refusal tests.

Принятие наблюдения требует неизменности всех трёх canonical documents и ETags, отсутствия held lease (включая просроченный), `resolved + committed`, отсутствия pending reservation и действительных host acceptance proofs **обоих** refs. Дополнительно сверяются target owner, candidate, предыдущий current, commit intent hash и proof hash завершённого intent. Artifact `japan-accepted-pair-46051339049-readonly-report.json` содержит runtime/image/generation identities, hashes доказательств и state hashes; исходные документы, ETags, nonces и receipt bodies в него не входят.

Receipt текущего runtime дополнительно обязан содержать точную новую Japan acceptance policy, `timingObserved=true`, `speedGateRequired=false`, `speedPassed=null` и Japan stability scope. Старый speed-success receipt не подходит для этого target. Report выводит проверенную политику явно; фактический rollback runtime заранее не задаётся.

Успех означает `verified=true`, `stableObservation=true`, `status=verified_current_and_rollback`. Это подтверждение состояния во время этих чтений; оно не измеряет host disk и не подтверждает актуальную доступность контейнеров. В отчёте всегда `stateMutations=0` и `deletionPermitted=false`. После него REG resume pins обновляются только по фактической паре; старые исторические A/B/C witnesses не переписываются. Сам retention controller заново проверяет state/lease/host proofs при реальном выполнении. До такого отдельного обновления прежние c6/a5 pins сохраняются и отказывают при несовпадении.

Минимальное продолжение после успешного release report:

1. Опубликовать проверенный controller с этим exact observer; отдельным marker-only push выполнить только наблюдение пары.
2. По artifact наблюдения сверить current runtime/image/generation, настоящий rollback и hashes обоих proofs. Если target изменился, остановиться без переноса старого результата.
3. Отдельной проверенной правкой обновить только `PINS.expectedRuntime` и `PINS.expectedRollbackRuntime` REG resume по наблюдению; остальные source/generation/history pins сохранить. Выполнить его целевые offline-тесты.
4. Отдельными marker-only pushes запустить REG retention и первый AJ compaction. Каждый controller повторно проверяет своё рабочее состояние непосредственно перед изменениями. Отчёты этих операций оцениваются отдельно от приёмки приложения.
