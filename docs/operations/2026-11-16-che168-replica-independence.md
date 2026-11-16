# Самостоятельная China replica: доказательство сохранённых данных

Статус: локальный scripts-only verifier, future-main producer hook, source-only materialization wiring и offline tests. Правила сбора/merge, приложение, контроллер выпуска, production pointers и GC не изменены. Реальных запросов к поставщику или объектному хранилищу этим этапом не выполнялось.

## Фактический разрыв

`scripts/catalog-auto-api-che168-bulk-intake.mjs` уже сохраняет полную SQLite-таблицу `inventory(id,payload,event)`. После CSV или восстановления предыдущей replica сборщик применяет изменения и подтверждённые удаления. После успешного `collectAutoApiChe168`, сохранения рабочего journal и выгрузки всех текущих строк он закрывает SQLite и передаёт весь файл в `saveChe168Replica`.

`scripts/lib/che168-replica.mjs` сохраняет последовательные gzip-части по 16 MiB и manifest с binding, cursor, размером и SHA256 каждой распакованной части. Следующий обычный цикл восстанавливает полный файл из committed replica. Его восстановление не читает предыдущие CSV или replica; отдельный новый journal применяется уже после восстановления. Существующий integration test удаляет исходный CSV перед повторным циклом.

Этого достаточно для существующего механизма возобновления, но прежние receipts не доказывают самостоятельную materialization для retirement. В них нет полного `integrity_check`, точной схемы, полного сравнения ID/payload/event и совпадения всех итоговых observation rows. Старый unit test replica использует строку `sqlite fixture`, поэтому сам по себе не проверяет SQLite.

Есть существенная разница между сохранённой БД и emitted rows: при выгрузке сборщик добавляет `lastSeenAt` и `che168ActiveVerification`, не записывая этот overlay обратно в SQLite. Новый verifier воспроизводит именно этот существующий overlay, сохраняя остальные поля и фактические detail dates.

## API

Новый файл: `scripts/lib/che168-replica-witness.mjs`.

```js
const witness = await verifyChe168ReplicaInput({
  storage,                 // object storage с readJson/getBinary; только чтение
  directory,               // абсолютный путь к завершённому output directory
  config,                  // тот же проверяемый snapshot config
  producer: {
    runId, attempt, sourceSha,
  },
  deadline,                // не более 300 секунд от текущего времени
  signal,                  // необязательный AbortSignal
  temporaryParent,         // по умолчанию os.tmpdir(), только временный runner workspace
});
```

`producer` обязан совпасть с фактическим ready/published pin этого source run, включая revision. Указанный source SHA должен быть предварительно проверен контроллером/владельцем исходника. Helper не обращается к GitHub и не объявляет произвольный commit прошедшим review/CI. Если workflow revision отличается от проверенного worker source, текущий узкий контракт не выдаёт witness; такая схема требует отдельного явного binding, а не ослабления сравнения.

Helper читает actual `report.json`, а не принимает `complete:true` вместо данных. Проверяются завершённый source report, единственный `autohome_used_china_open`, cursor, initial cursor, изменения, count/observations, replica descriptor, snapshot binding и точная связь рабочего journal с base descriptor. Дополнительные источники в China report не получают доказательства за счёт этой проверки.

Разрешённые удалённые чтения:

- manifest и последовательные gzip-части **только новой current replica**;
- один фактический head соответствующего рабочего journal;
- actual producer pin, указанный в завершённом report.

Исторический CSV, base replica и старые journal chunks не читаются и не используются для восстановления. В helper отсутствуют `writeJson`, PUT, DELETE, публикация или вызов поставщика.

## Полная проверка после восстановления

1. Проверить descriptor и manifest; восстановить файл через существующий `restoreChe168Replica` в новую пустую временную директорию. Путь старой локальной БД не передаётся verifier-у.
2. Проверить SQLite header и отсутствие зависимости от WAL/SHM. Формат WAL остаётся неeligible для этого узкого proof, даже если его checksum совпал.
3. Открыть файл read-only, с отключённой загрузкой расширений и trusted schema. Проверить точную существующую таблицу/primary index; дополнительные таблицы, view, trigger и другая схема не принимаются.
4. Выполнить полный `PRAGMA integrity_check`, проверить page count/size и точное число строк.
5. Прочитать все строки в binary order по source ID, проверить source/market/stable ID, canonical JSON payload и допустимый existing event interval. Существующая включительная граница `event <= cursor` сохраняется. Сформировать ordered ID и `[sourceOfferId, payloadHash, event]` digests.
6. Воспроизвести точный active verification overlay. Сравнить каждую фактическую emitted JSONL строку: ID, полный payload, stage, observedAt, количество, отсутствие пропусков и duplicates. Порядок файлов выдачи не меняется; общий normalized digest использует ASCII-sorted `[id, payloadHash]`.
7. Повторно проверить manifest, journal head, producer pin, локальный report и полный byte hash каждого output shard. Проверить неизменность восстановленного SQLite и отсутствие дополнительных файлов. Удалить временный restore directory в успешном и ошибочном пути.

SQL работает в отдельном Worker с лимитом heap и принудительным завершением по deadline. По умолчанию допускаются не более 1024 replica parts / 16 GiB восстановленного файла, 500000 строк, 1 MiB на payload, 2000 observation shards / 8 GiB суммарно, 4 MiB report. Переданные limits могут только уменьшить эти пределы. Это границы пригодности proof; они не обрезают действующий каталог.

Существующий `storage.getBinary` возвращает уже загруженный Buffer. Helper ограничивает его перед распаковкой и ограничивает собственное ожидание, но не заявляет транспортную streaming-bound/drain гарантию этого старого порта. Реальная transport acceptance и стоимость проверки полного рабочего объёма здесь не измерялись. Копия SQLite временная и ограниченная, постоянный архив на диске VM не создаётся.

## Completion authority и предел утверждения

Существующий collector выставляет `completed` после успешного change-stream, а source report сохраняет точные cursor/changes. Отдельный сырой terminal empty `/changes` response прежним протоколом не архивируется. Поэтому witness явно содержит:

```json
{
  "authority": "saved_completed_producer_report",
  "terminalResponseArchived": false
}
```

Это проверка независимой materialization **этих сохранённых данных** на основании связанного с producer завершённого отчёта и exact journal/cursor. Она не заявляет наличие отсутствующего terminal response, свежий supplier probe, полноту рынка вне существующего feed contract или новое основание для withdrawal.

Ещё один реальный случай: `openChe168ReplayJournal` не сохраняет head до первого commit. Для zero-change run допускается фактическое отсутствие head только при `cursor == initialCursor` и `changes == 0`. Receipt содержит `journalHeadFound:false` и digest `null`; сохранённый head не выдумывается. Непустой replay без exact head отклоняется.

## Общий contribution contract и durability

Возвращается signed `sourceInputWitness` с `kind: independent_che168_replica_v1`:

- `snapshot`: current replica root, exact manifest digest, количество и digest частей, число строк и completedAt;
- `normalized`: полный count и ASCII-sorted ID/payload-pair digests;
- `replicaReadback`: schema/file/ordered inventory/output digests, binding, cursor/event interval и конкретная completion authority;
- `producer` и общий checksum.

Это согласованное дополнение к generic `independent_source_snapshot_v1`, а не второй ledger. Отдельного mutable alias или нового leaf внутри replica root нет. Чтобы witness стал долговечным, source caller добавляет его в completed report **до** существующего immutable `archiveIntakeDirectory`. Existing archive сохраняет и заново читает actual report parts и complete manifest. Offline test проходит этот настоящий archive/restore путь и проверяет отказ при изменённом report part.

`catalog-auto-api-che168-bulk-intake.mjs` вызывает optional proof после completed checkpoint: SQLite уже закрыта, replica сохранена, emitted rows и ready pins существуют. Повторный штатный atomic checkpoint добавляет `sourceInputWitness` перед последующим immutable archive. CompletedAt, counts, supplier requests, обычные merge/admission и прежние refs не изменяются.

Hook активен только для будущего `refs/heads/main` в `jeep-jim/AvtoCena`. `che168ReplicaWorkerSource` проверяет tracked closure, отсутствие любых tracked изменений и untracked кода в scripts/app libraries/packages, затем читает actual HEAD. Этот SHA должен совпасть с workflow SHA и actual owner/run/attempt; чужой frozen checkout не получает witness от подставленного owner SHA. При mismatch или ошибке optional proof отчёт получает безопасный `sourceInputWitnessUnavailable`; исходные completed данные и все старые зависимости сохраняются.

Положительный actual-entrypoint test поэтому выполняется на committed clean checkout. Он запускает настоящий bulk producer с его actual HEAD, затем удаляет CSV и проверяет новый replica witness второго цикла. Проверка не имеет test-only обхода git/source guard. Другие tests отдельно доказывают отказ для dirty/untracked code, feature branch и несовпадающего source.

Общий publication contribution теперь отдельно связывает witness с фактическими normalized/internal/public rows через `catalog-che168-contributions.mjs`, converter и стандартные callbacks publisher. Если output заимствует прежние данные или не совпадает по payload, прежние roots сохраняются. Затем обычные coordinated current/previous/pending/cursor/config refs должны быть обновлены с этим доказательством. Один witness не выдаёт GC разрешение.

Активный snapshot config по-прежнему может защищать исходный CSV для штатного fallback/bootstrap, а current/previous поколения, loading/ready writers и незакрытые pointers остаются защищёнными. Самостоятельная новая replica даёт путь убрать **накопленную цепочку прежних base replicas/journals** после общего materialization/CAS proof; она не означает, что сейчас разрешено удалить все China roots.

## Проверки

Адресный suite содержит реальные SQLite fixtures и работает с offline-fetch. Покрыты полное восстановление, multi-part файл, более 500 output rows, точный overlay, zero-change resume без base, immutable archive roundtrip, полный integrity_check, повреждение parts/schema/source/events, WAL без sidecars, missing/duplicate output, изменение root/report/pin во время чтения, bounds/deadline, source guards и неизменность хранилища.

Отдельный negative fixture меняет payload в SQLite primary index: `quick_check` остаётся `ok`, а полный `integrity_check` и новый witness отвергают файл. Это проверяет реальное различие двух проверок, а не только наличие строки PRAGMA в исходнике.

Официальная семантика SQLite integrity/quick checks: https://www.sqlite.org/pragma.html#pragma_integrity_check.

Команда:

```sh
node --import tsx --import ./tests/helpers/offline-fetch.mjs --test \
  tests/che168-replica-witness.test.ts \
  tests/che168-bulk-snapshot.test.ts \
  tests/che168-replay-journal.test.ts \
  tests/nonjp-intake-archive.test.ts
```


## Подключённая source-only materialization

`tests/catalog-che168-contributions.test.ts` использует реальный SQLite restore,
immutable archive и штатный converter. Оба этапа materialization сверяют actual
internal/public chunks, projection и archived input, затем generic reader
независимо проверяет всю цепочку. Только capability закрытого Che168 instance
может заменить историческую union. Непустой другой China source, partial/delta,
различающиеся converted bytes или старое заимствованное поле оставляют прежние
roots и unknown provenance.

Обычная `mergeOfferVersions` вынесена без изменения поведения в
`catalog-offer-merge.mjs`. Для доказательства независимо вычисляется та же
retained-ветка с пустым `{}`; сравниваются полные фактические serialized bytes.
Никакие поля не отбрасываются и никакие значения не округляются ради равенства.
Пустой baseline не несёт прежнего firstSeenAt, photos, manual/power, totalRub или
operational/raw. Отрицательные проверки каждого такого сохранённого поля
подтверждают недоступность proof; сам коммерческий результат не меняется.

Всё это код для будущих source runs. Текущие active jobs, producer source pins,
VM приложение, policy/coverage и реальные DELETE этим этапом не изменялись.
