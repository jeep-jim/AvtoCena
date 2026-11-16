# Граница HTTP-публикации exact 83 — 16.11.2026

Проверенный source commit: `83ff17075e9188dcf227c8752dc064248d5f42e0`.
Его исходный Git tree: `bb3673c22ccc3a70d6711c53678c9aa5e6238eda`.

Это локальный офлайн аудит исходников штатного Next-процесса. Он не проверяет
живой health, фактические процессы VM, cron, Actions или произвольные CLI,
не устанавливает приложение и не утверждает полноту production writer coverage.
Результат f45 не подменяет эту отдельную проверку 83.

## Проверенная цепочка и результат

| Участок исходника 83 | Граница |
| --- | --- |
| `apps/web/app/(public)/api/catalog/import/route.ts` | Admin token обязателен; из JSON в importer передаётся только `sources` |
| `apps/web/lib/catalog/importer.ts` | Массив превращается в `{sourceIds: ...}`; publication callbacks не добавляются |
| `apps/web/lib/catalog/importer-impl.ts:420` | Фактический вызов `persistCatalogOffers(offers)` без options |
| `apps/web/lib/catalog/storage.ts:1579` | Production refresh требует настоящие `beforePersistValidate` / `beforePublishValidate` и сохранённые остальные рынки |
| `apps/web/lib/catalog/storage.ts:1598` | Константа `CATALOG_PRODUCTION_WRITES_PAUSED=true` останавливает object-storage persistence до `getJsonStorage`, manifest reads и writes |
| `persistInternalCatalog` | Единственный app caller — заблокированная выше цепочка `persistCatalogOffers` |
| `apps/web/lib/data.ts:465` | Установленный production release без object driver отклоняется |
| `Dockerfile` | Штатный runner запускает `node apps/web/server.js`; catalog worker/cron в startup не добавлен |

Реальные модули 83, а не их копии или имитация guard, прошли три теста:

1. Прямой API-подобный persist при seller mode `0` и `1` отклонён с
   `catalog_production_writes_paused`: **0 storage reads, 0 storage writes**.
2. Реальный importer с source ID без совпадения дошёл до того же guard.
   Наблюдались только **3 записи `catalog/import-lock.json`**.
3. Реальный POST без token вернул `403` без writes. Авторизованный POST с
   посторонними publication callbacks, market и `reportPath` в JSON остановился
   на том же guard; только **3 записи import lock**.

**3/3 PASS**, Node `24.22.1`. Fetch запрещён самим тестом; попыток сети не было.
ObjectJsonStorage читает и пишет только тестовую память. Использованы фиктивные
credentials. Тест не вызывает ни один supplier adapter. Полный suite не запускался.

## Инвентаризация остальных записей

Дополнительно просмотрены AST call sites 916 файлов `apps/web` и `packages`,
storage mutation/delete methods, их callers, dynamic-call sites и raw namespaces.
В исходниках приложения 83 не найден writer для:

- `catalog/raw-feed-config/v1/che168-snapshot.json`;
- `catalog/intake-cursors/v1/`;
- `catalog/provider-snapshots/che168/` и `catalog/provider-replicas/che168/`;
- `catalog/intake-working/che168-v1/` и `catalog/intake-staging/encar/`;
- `catalog/nonjp-intake/v1/` и `catalog/raw-feed-coordination/`;
- `catalog/paid-encar-reports/v1/`.

Manifest writers привязаны к описанной цепочке. Runtime budget/sort caches
пишут производные `catalog/runtime-budget-prices-v3/` и
`catalog/runtime-sort-prices-v3/`, а не raw roots или intake cursors.
Owner collection controls, importer lock/scans/health/source policy,
CRM/account/media, editorial/manual facts и rates сохраняют отдельные записи.
Удаления приложения относятся к ограниченным CRM/account/media namespaces
и временному `.health` probe. Raw-root HTTP delete endpoint не найден.

**Сервер не объявляется read-only.** Обычный импорт может обращаться к своему
источнику и писать служебные данные до запрета публикации. Нулевые reads/writes
относятся именно к вызову `persistCatalogOffers` с API-style options.
Экспортированный `persistInternalCatalog` сам по себе не блокирует произвольный
внешний CLI caller; такие процессы должны проверяться отдельно.

## Отличие страховых отчётов от f45

В 83 отсутствует `apps/web/app/api/catalog/korea-report/paid-report-reader.ts`.
Его `korea-report/route.ts` использует legacy AJES report service, а не сохранённый
`catalog/paid-encar-reports/v1/` reader из f45. Endpoint не вызывался.
Это уточнение версии, не разрешение снять общую защиту `encar-reports`: другие
процессы и следующие версии приложения этим source-аудитом не покрыты.

## Воспроизведение

Из корня evidence checkout с уже установленными зависимостями:

```bash
TSX_TSCONFIG_PATH=apps/web/tsconfig.json node --import tsx --test docs/evidence/live83-vm-write-audit.test.mts
```

Перед импортом тест проверяет source ancestry, точное совпадение Git tree/blob
для `apps/web`, `packages`, `data`, `scripts`, Dockerfile и package manifests,
отсутствие dirty/untracked runtime inputs. Документальные descendants 83 допустимы;
другой runtime отклоняется до выполнения. На произвольном main этот evidence
тест не заменяет аудит его собственного source.

Использован sparse checkout размером около **41 MiB** с общей ссылкой на
`node_modules`. Полное `data` не выгружалось. Sparse directories:

```text
apps/web/lib
apps/web/app
packages
tests/helpers
data/catalog/research
data/catalog/power-reference
data/catalog/korea-official-power
```

Первая попытка исполнения остановилась до тестов из-за отсутствовавшей sparse
зависимости `scripts/encyclopedia/power30-precedents.mjs`. Материализован только
её точный tracked blob, без изменения исходника:

```bash
git restore --source=83ff17075e9188dcf227c8752dc064248d5f42e0 --worktree --ignore-skip-worktree-bits -- scripts/encyclopedia/power30-precedents.mjs
```

После этого три сценария прошли. В evidence commit сохранены только этот отчёт
и воспроизводимый тест; большой AST JSON, credentials и данные поставщиков
не включены. Roadmap, приложение, schedules, source pins и deployment gates
не менялись. Внешних writes, workflow launches и live/source requests не было.
