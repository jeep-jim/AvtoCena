# Текущий шаг

Checkpoint: **27.11.2026 13:10:02, Asia/Krasnoyarsk**. Рабочий runtime сохранён на **a5ca**, Китай C принят. Японский кандидат **92b** откатился **12:46:18,483**: в том же пользовательском запросе зафиксирован HTTP 500 источника, ответ оказался stale/partial. Новый исходник **733** опубликован; его CI и живая приёмка ещё не выполнены. Исправление Японии на сайте пока не принято.

Первичные доказательства и границы выводов: [новый rollback / CI / inventory / audit](../operations/2026-11-27-japan-stability-rollback.json). История: [предыдущий 889 rollback](../operations/2026-11-27-japan-pagination24-rollback.json), [принятие Китая и прежние очистки](../operations/2026-11-27-disk-china-japan-followup.json). Этот статус заменяется, история сюда не дописывается.

## Япония: причина отказа приёмки установлена, причина HTTP 500 — нет

- Кандидат **92b520d7a63b3be0078c14fb0384133818a52e23**, scope **catalog-japan-stability-v1**. Исправления выбора марки/модели, японских рекомендаций, допуска транспорта, добора до 24 и текста над каталогом остаются в исходнике кандидата; их работа на принятом сайте ещё не подтверждена.
- [CI 45944734653](https://github.com/jeep-jim/AvtoCena/actions/runs/45944734653) — PASS: **1339 controller / 475 native**, браузерные fixtures пройдены. Локальные и fixture-проверки не заменяют свежую живую приёмку.
- [Выпуск 45945260193](https://github.com/jeep-jim/AvtoCena/actions/runs/45945260193): **rolled_back**, published=false, recovered/retentionPreserved/leaseReleased=true; retained runtime **a5ca426eec2663eb17c2df69fe2bfed46e2b8740**. Завершён **2026-11-27T05:46:18.483Z**.
- Первый обычный ответ **plain_first** в **12:45:27,855**: HTTP200/ok=true, **shown=22, received=24, stale=true, partial=true**, interrupted/scanLimited=false, hasMore=false, total=null. Это неполная выдача, не доказательство конца каталога или отсутствия машин.
- **Page receipt присутствует:** stats/list, page=1, pageSize=24, requestId **25ce2819-c670-43e2-a8c7-fb5e733a18b1**, queryHash **f2295e1764a0e8049475c136f267b7ed76e7aed28c7db686a1fc5c7b2d99fd73**; supplierAttempted=true, reason=**http_500**, outcome=stale, **12:45:26,858–12:45:27,541**. Резервный observedAt — **12:20:14,690**. Отдельный catalog receipt отсутствует; не смешивать это с наличием точного page receipt.
- **Внутренняя причина HTTP 500 неизвестна.** Receipt доказывает отказ источника в этом запросе, но не конкретную SQL-ошибку или неподдерживаемый оператор. Проверка остановилась на plain_first; успешного live-доказательства фильтров, 24 карточек/продолжения, рекомендаций, UI и расчётов нет.
- **Точный общий Japan power-count и глобальный порядок known→unknown не реализованы и не подтверждены.** Source COUNT не равен итоговому отбору после local/manual power, visibility и admission. Число карточек страницы не выдавать за общий результат; AJ mirror не разрешён.
- Не ослаблять freshness, полноту, source/price/UI/rollback проверки и не выдавать stale fallback за исправление. Не повторять тот же выпуск вслепую.
- Новый кандидат **73321a180c16d1d432559d572a2ac2b7fdf5cc2b**, tree **1284b355244f89389a674203d3d97eee183f12d2**, опубликован в удалённой ветке: **7 файлов**. Только для Japan запросов без явного drive компактная wire-форма использует сгруппированные `=` / `LIKE`; canonical hashes версии 92b и прежняя compact-форма explicit-drive сохранены. **139 целевых тестов, полный offline набор 2986/2986 и typecheck — PASS**; новый CI ещё не запускался. Это исправление риска совместимости, не доказанная причина прежнего HTTP 500.

## Сервер и автоматическая очистка

- Последний [read-only inventory 45943335063](https://github.com/jeep-jim/AvtoCena/actions/runs/45943335063) снят **12:02:15**, до выпуска 92b: диск **102 916 472 832 B**, доступно **51 153 801 216 B = 51,154 GB = 47,641 GiB**. Health a5ca и контейнеры неизменны, mutations/providerRequests=0. Это не новый inventory после отката.
- После доказанного отката 92b автоматически удалён **ровно 1 его неиспользуемый app image**, completed=true/uncertain=false. Измеренный прирост свободного места **1 191 747 584 B = 1,110 GiB**, `diskFreeBytesAfter` **51 142 254 592 B**. Это возврат места данной попытки, не дополнительное сокращение прежних накоплений.
- Ранее проверенные очистки освободили **35 529 195 520 B = 33,089 GiB**. Их исторические доказательства сохранены отдельно. Текущие и возвратные развёртывания, pins и ссылки контейнеров защищены; force/prune и общая очистка `catalog/` запрещены.
- Последний подтверждённый REG generation GC — [45901649316](https://github.com/jeep-jim/AvtoCena/actions/runs/45901649316): **paused, storage_transport/lease_lost**, leaseReleased=true; C/a5ca сохранены, **2 A/B задачи pending**. Новые удаления этих поколений не подтверждены; lease/TTL не сбрасывать.
- Controller **f6693cd38c7b7f342b55b8046dd86db9d6ba9916** опубликован в main: **11 файлов**, включая ограниченный повтор pending retention при `not_due` и отдельный AJ cache audit/canary. Фид, расписание, runtime и формулы этим commit не меняются.
- [CI f669 / 45948428767](https://github.com/jeep-jim/AvtoCena/actions/runs/45948428767) — PASS, завершён **12:57:28**: **1373 controller / 475 native**. Отдельный локальный набор **1379 PASS** включает ещё 6 проверок; это не число controller-тестов CI.
- **Production not_due drain пока не подтверждён.** Он допускается только после успешного preflight при resolved/committed accepted state и pending queue, под прежними lease/CAS/fences и ограниченным cleanup deadline. Отказ или откат нового выпуска не дают права считать этот путь выполненным.

## AJ cache: audit и quoted canary завершены

- [Audit 45948685870](https://github.com/jeep-jim/AvtoCena/actions/runs/45948685870), marker **c5d385c500897f1cb60ceab5e44337e8cb0037cb**, approved controller **f6693cd**: **bounded_audit_complete**, завершён **12:56:28,491**. Private bucket проверен; **versioning=never_enabled, lifecycle=absent**.
- Просмотрено по **200 текущих объектов stats и queries**; оба обхода неполные. Прочитано **8 выбранных старых тел, все 8 просрочены по observedAt**, changedDuringRead/invalid=0. Это выборка, не полный объём AJ и не оценка его расхода диска; история версий и host disk здесь не измерялись.
- Audit: **17 запросов**, cacheMutations/directSupplierRequests=0, rawPayloadsPersisted=false, cacheDeletionEnabled=false. Автоудаление рабочего AJ cache этим audit не включено.
- [Quoted canary 45948906947](https://github.com/jeep-jim/AvtoCena/actions/runs/45948906947), marker **8ecfe55a9e8db47c564bcea75faff6c797d65d3a**, завершён **12:58:42,845**: **capability_not_verified / stale_precondition_not_enforced**. DELETE с устаревшим ETag **в кавычках** не сохранил обновлённый собственный тестовый объект. **Matching DELETE не выполнялся**, residuePossible=false; 2 synthetic PUT / 1 synthetic DELETE, cacheMutations/directSupplierRequests=0. Рабочий AJ cache не изменялся, его очистка не включена.
- Вывод canary ограничен **quoted header / current object**: он не доказывает поведение значения ETag без кавычек или поддержку CAS PUT. Отдельная bare-проверка готовится в другой ветке и **ещё не принята**; её результата нет в этом checkpoint.

## Китай, расчёты и CRM: принятые данные сохранены

- Китай **gen_china_45875678028_1** принят [27.11 в 04:06:21](https://github.com/jeep-jim/AvtoCena/actions/runs/45875678028). Source observedAt **27.11 02:04:39,089**, cursor **13 340 204**; это прежний принятый C, не новый импорт при выпуске Японии.
- Публичная проверка **12:02:22**: a5ca/C, **281 310 автомобилей**, **70 059** с китайским powerTo=160. Последнее число относится только к Китаю. В C: **179 612 priced + 101 698 seller-only + 0 unpriced = 281 310**, **9 283 230** ценовых строк на 33 города; не заявлять, что все машины рассчитаны заново.
- Pricing runtime **64c6338e0db23c8999096bceefbf113c0136fe15**, calculationVersion **4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90** и формулы сохранены. Release report: generationRestores/priceCalculations/generationWrites/encyclopediaWrites/otherMarketWrites=0.
- Основной China cron — **21:00 Красноярск**, резервные due-проверки — **01:17, 04:17, 07:17, 10:17, 13:17, 16:17, 19:17, 22:17**. Metadata **12:02:23**: workflow active, последний видимый schedule [45924186669](https://github.com/jeep-jim/AvtoCena/actions/runs/45924186669) завершился success; точность времени cron и новый импорт этим не доказаны.
- CRM/фото приняты в a5ca [27.11 04:48:06,798](https://github.com/jeep-jim/AvtoCena/actions/runs/45897728809). CRM читает проверенный mounted manifest; контроль **12:02:22** без входа — **401 auth_required**, Set-Cookie отсутствует. Вход владельца HTTP200 самостоятельно не проверен. Энциклопедия, ручные значения, ID, CRM, пользователи, дилеры и авторизация сохраняются.

## Разрешённый следующий шаг

Подготовить controller-plan для точного **733**, пройти новый CI, затем выполнить ограниченную свежую приёмку обычного пользовательского пути. До её результата source-query compatibility остаётся проверенной локально, а причина прежнего HTTP 500 — неизвестной. Отдельно проверить подготовленный bare-canary и определить безопасный executor очистки AJ cache, защищающий свежую запись; audit и завершённая quoted-проба такого executor не включают.

Работа ограничена Японией и необходимой безопасной очисткой. Соседние рынки, принятый Китай, формулы и CRM не менять. Сохраняются ограничения [japan.md](japan.md): запросы посетителей/разрешённый кэш, без DUMP, зеркала, массового обхода и подмены IP. Ранее отклонённый прямой диагностический GET поставщика не повторять другим инструментом; сохранённые receipts и обычные разрешённые пути не расширяют эту границу.
