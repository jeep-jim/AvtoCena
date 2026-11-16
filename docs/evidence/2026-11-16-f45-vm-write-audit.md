# Аудит записей Next-процесса f45 — 16.11.2026

Проверенный исходник: `f45efaf2b172af41d14987fb642e8e6b6df78cdd`.
Проверка локальная и офлайн: без поставщиков, S3, запуска workflow, установки
приложения или изменения source pins. Это не проверка всех процессов/ручных CLI
на production VM и не подтверждение установки f45.

## Вывод и граница

В штатной Next/HTTP-поверхности этого исходника публикация public/internal
catalog manifest из API блокируется до чтения или записи хранилища. Это не
препятствует завершению отдельно согласованной подготовки кандидата, но не
означает готовность полного raw GC и не называет весь сервер read-only.

`apps/web/app/(public)/api/catalog/import/route.ts` проверяет admin token и
передаёт только `sources`. `apps/web/lib/catalog/importer.ts` сохраняет эту
границу. `importer-impl.ts` вызывает `persistCatalogOffers(offers)` без options.
В `apps/web/lib/catalog/storage.ts` константа
`CATALOG_PRODUCTION_WRITES_PAUSED=true` блокирует object-storage persistence:
разрешённый refresh требует настоящие callback-функции и сохранённые остальные
рынки, которых у API нет. Проверка стоит до `getJsonStorage`, manifest reads и
внутреннего `persistInternalCatalog`. Другого app caller последнего не найдено.

`apps/web/lib/data.ts` отклоняет установленный production release без object
driver. Docker runner запускает Next `apps/web/server.js`; worker/cron не
добавлен в startup. Внешние Actions, CLI и другие VM-процессы требуют отдельного
writer coverage; прямой экспорт internal persistence сам по себе не является
универсальной защитой от такого внешнего вызова.

## Воспроизведение

Из корня этого evidence checkout с уже установленными зависимостями:

```bash
TSX_TSCONFIG_PATH=apps/web/tsconfig.json node --import tsx --test docs/evidence/f45-vm-write-audit.test.mts
```

Тест проверяет source commit, ancestry, идентичность Git tree/blob для runtime,
packages, data, Dockerfile и package manifests, отсутствие dirty/untracked
runtime inputs. Затем импортирует фактические модули f45, подменяет только
ObjectJsonStorage транспорт памятью, задаёт фиктивные credentials и запрещает
любую попытку fetch. Документальные descendants допустимы; другой runtime
отклоняется до импорта.

Проверенные результаты:

| Сценарий | Результат |
| --- | --- |
| Прямой API-подобный persist, seller mode 0 и 1 | `catalog_production_writes_paused`; 0 storage reads / 0 writes |
| Фактический importer, source ID без совпадения | Та же остановка; только 3 записи `catalog/import-lock.json` |
| Фактический POST без token | HTTP 403; 0 writes |
| Авторизованный POST с посторонними publication/reportPath полями | Поля не переданы; та же остановка и только 3 записи lock |

Все 3 теста прошли. Source/network/storage requests отсутствовали. Не запускался
полный test suite: проверена конкретная граница публикации.

## Проверка остальных mutation paths

Просмотрены storage mutation/delete call sites в `apps/web` и `packages`, их
callers, raw namespaces и container entrypoint. В приложении не найден writer
для `catalog/raw-feed-config/v1/che168-snapshot.json`, `catalog/intake-cursors/v1/`,
`catalog/provider-snapshots/che168/`, `catalog/provider-replicas/che168/`,
`catalog/intake-working/che168-v1/`, `catalog/intake-staging/encar/`,
`catalog/nonjp-intake/v1/` или `catalog/raw-feed-coordination/`.

Служебные записи importer lock/scans/health/source policy сохраняются.
`collection-controls.ts` пишет отдельный owner-control объект с CAS;
переключение collection controls не предоставляет отсутствующие callbacks.
CRM/account/media, editorial/manual calculations, rates и производные price/image
кэши также пишутся. Они не являются перечисленными raw-root pointers.
App deletion call sites ограничены собственными CRM/account/media namespaces
и одноразовым `.health` probe; raw-root HTTP delete endpoint не найден.

## Страховые отчёты: обязательное ограничение GC

`apps/web/app/api/catalog/korea-report/paid-report-reader.ts` читает
`catalog/paid-encar-reports/v1/<observedAt>/`, проверяет complete/bucket/digests и
generation до/после чтения. Durable reader claim отсутствует. Повторная проверка
не удерживает root от удаления во время запроса после двух быстрых cutover.

Поэтому весь raw kind `encar-reports` должен оставаться защищённым, пока нет
отдельно проверенного reader protocol. Current+previous не заменяют его.
Возможный GC остальных kinds требует их собственного полного source/writer
coverage. Этот аудит не включает bootstrap, GC, source collection или release
activation.
