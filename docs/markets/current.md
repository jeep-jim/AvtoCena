# Текущий шаг

Checkpoint: 2026-11-27T07:56:47.000+07:00, Asia/Krasnoyarsk. **Рабочий сайт остаётся на a5ca; Китай C принят. Выпуск исправления японской пагинации 889 откатился после живой проверки. Причина и новый контроль состояния приведены ниже.**

Краткие первичные доказательства: [откат и проверка](../operations/2026-11-27-japan-pagination24-rollback.json), [исходник и CI](../operations/2026-11-27-japan-pagination24-proof.json). Предыдущие очистки и принятие Китая/CRM: [машинное доказательство](../operations/2026-11-27-disk-china-japan-followup.json). Этот статус заменяется, история сюда не дописывается.

## Диск

- Две ранее проверенные очистки дали **35 529 195 520 B = 33,089 GiB** измеренного прироста свободного места: [8 неиспользуемых образов](https://github.com/jeep-jim/AvtoCena/actions/runs/45871243184) и [2 завершённых развёртывания](https://github.com/jeep-jim/AvtoCena/actions/runs/45875206041).
- [Контроль после отката 45919061523](https://github.com/jeep-jim/AvtoCena/actions/runs/45919061523), **27.11 07:50:41**: всего **102 916 472 832 B = 95,848 GiB**, доступно **51 191 820 288 B = 47,676 GiB**, занято **50,243%**. Health a5ca и 4 контейнера неизменны, mutations/providerRequests=0.
- В controller **6b1c87cba54be732229728542dedcd50fdfc3ab3** добавлено удаление одного точно установленного неиспользуемого app image после принятого выпуска либо доказанного отката. Сохраняются текущий и возвратный образы, pins и ссылки всех контейнеров; deletion без force и prune, под существующей lease и обеими host locks.
- [CI 45914166772](https://github.com/jeep-jim/AvtoCena/actions/runs/45914166772): **1301 controller / 448 native**, web/engine typecheck, **23 host image cases**, браузерные **8 pagination + 12 photo + 4 city + 2 CRM** — PASS.
- В реальном откате [45914646851](https://github.com/jeep-jim/AvtoCena/actions/runs/45914646851) новый cleanup удалил **1 образ неудачного 889-выпуска**, completed=true/uncertain=false. Измеренный прирост **1 191 686 144 B = 1,110 GiB**. Он возвращает место, занятое этой попыткой, и не прибавляется к 33,089 GiB предыдущего устранения накоплений.
- REG object GC остаётся **paused** после [45901649316](https://github.com/jeep-jim/AvtoCena/actions/runs/45901649316): storage_transport/lease_lost, leaseReleased=true. C/a5ca сохранены, 2 известные A/B задачи pending; новые удаления не подтверждены. Диагностика опубликована в 092f403, CI **1203/1203**; нового GC запуска не было. Не повторять вслепую, не сбрасывать lease/TTL.
- Защищённые активное и возвратное развёртывания содержат данные; не считать их мусором. Pre-reservation process-loss cleanup не покрыт новой terminal image phase.

## Китай

- [Сбор 45875678028](https://github.com/jeep-jim/AvtoCena/actions/runs/45875678028) принят **27.11 в 04:06:21 Красноярск**, generation **gen_china_45875678028_1**, leaseReleased=true.
- **281 310 автомобилей**, источник наблюдался **27.11 02:04:39,089**, cursor **13 340 204**. Исходные строки: **287 657 + 9 562 − 7 575 = 289 644**; **281 310 допущенных + 8 334 исключённых = 289 644**. Расчёт: **179 612 priced + 101 698 seller-only + 0 unpriced = 281 310**; **9 283 230** ценовых строк для 33 городов. Не заявлять, что все машины рассчитаны или загружены заново.
- Pricing runtime **64c6338e0db23c8999096bceefbf113c0136fe15** и формулы сохранены. Data-only сбор: applicationBuilds/encyclopediaWrites/otherMarketWrites=0.
- Публичный контроль **27.11 07:50:49**: exact a5ca, C, **281 310** всего и **70 059** с китайским powerTo=160; CRM без входа 401. Число 70 059 относится только к Китаю.
- Основной cron: **21:00 Красноярск**; резервные due-проверки: **01:17, 04:17, 07:17, 10:17, 13:17, 16:17, 19:17, 22:17**.
- Подтверждён новый **event=schedule**: [45907437719](https://github.com/jeep-jim/AvtoCena/actions/runs/45907437719), создан **27.11 05:51:54**, завершён **05:54:39,851**. Status **not_due**, published/sourcePrepared=false, applicationBuilds=0, leaseReleased=true; сохранён C с прежними source date/cursor. Это автоматическая проверка, а не новый импорт. Точная cron-строка в evidence отсутствует; причина исходного пропуска и соблюдение времени primary не установлены.
- Metadata **27.11 07:50:50**: workflow active, repo/main доступны; последние 20 запрошенных schedule records содержат 2 запуска этого workflow, наиболее новый — 45907437719. Надёжность точного времени cron не заявляется.

## CRM и фотографии: приняты в a5ca

Runtime **a5ca426eec2663eb17c2df69fe2bfed46e2b8740**, tree **5a6d2c7723e9834204eb3896c06271adb2659991**, scope **catalog-crm-japan-photo-retry-v1**. [Принят 27.11 04:48:06,798](https://github.com/jeep-jim/AvtoCena/actions/runs/45897728809); C/manifest/source date/формулы сохранены. От 077 — 10 файлов: 6 CRM и 4 фото/тесты.

CRM читает дату источника и число машин из проверенного mounted manifest. Unsigned endpoint — **401 auth_required**, без Set-Cookie. Вход владельца HTTP200 самостоятельно не проверен.

Фото: исправлена постоянная заглушка после первого сбоя AJ image. До 2 повторов того же разрешённого URL, отмена при load/src change/unmount. [Обычная мобильная проверка](https://github.com/jeep-jim/AvtoCena/actions/runs/45901589529) **27.11 04:58:04–04:58:23**: **23/23 фото загрузились**, 320×240, pending/failed/placeholders=0; retry не потребовался. Причина исходного скриншота не установлена, это не гарантия доступности всех фото.

## Япония: исправление добора не принято

- Runtime **889c5150803f7973fc371d1d90491bb38cbabf82**, tree **c9d6371dab51839ace654703509d1272656adf93**, scope **catalog-japan-pagination24-v1**, изменяет ровно **11 файлов**. CI и fixtures пройдены. Добор использует прежние source pages по **24**, query/page-bound j1 cursor, проверяет повторы/пропуски; убирает длинный текст над выдачей и фиктивные будущие страницы.
- [Живой выпуск 45914646851](https://github.com/jeep-jim/AvtoCena/actions/runs/45914646851) завершён **27.11 07:32:02,861**: **rolled_back**, published=false, errorCode=china_daily_release_japan_browser_failed, recovered/retentionPreserved/leaseReleased=true; сохранён **a5ca**.
- [Архив отказа независимо проверен](https://github.com/jeep-jim/AvtoCena/actions/runs/45919061523): **plain_first / japan_browser_unavailable_or_stale**. Ответ HTTP200/ok=true/24 карточки, stale=true, partial/interrupted/scanLimited=false; oldest observedAt **26.11 17:43:51,525**, получен **27.11 07:31:25,915** (49 654,390 s позже). До power/UI/continuation/calculation проверки не дошли. Без receipt конкретная исходная страница неизвестна. Saved source failures имеют другие SQL hashes и времена вне запроса; новый upstream500 не установлен.
- Последнее обычное наблюдение a5ca: **23 карточки**, «Показано 23», «Количество уточняется» при powerTo=160/Новокузнецк. Не объявлять пустую ячейку исправленной до принятия свежей живой проверки.
- **Общий точный Japan power-count и глобальный порядок known→unknown не реализованы.** Source COUNT не равен финальному отбору после local/manual power, visibility и admission. Число показанных на странице не выдавать за общее. Нужен эквивалентный итоговому правилу агрегат либо уже разрешённый полный актуальный inventory; разрешения на AJ mirror нет.
- Предыдущий b25 тоже не принят. Его HTTP500 не считать причиной нового отказа без отдельного evidence.
- Не ослаблять freshness, полноту, source/price/UI/rollback проверки ради выпуска; не повторять прежнюю попытку без новой установленной причины или конкретного исправления.

## Ограничения и следующий шаг

Один GET схемы AJ ранее отклонён автоматической проверкой разрешений из-за запрета прямой диагностики поставщика. Пустой ответ не дал новой авторизации; запрос не выполнен и другим инструментом не повторён. Обычные пользовательские запросы остаются в прежней области разрешения.

Executor/browser локально недоступны; исходники и проверки сохранены в Git/GitHub Actions. Ошибку инструмента не считать HTTP-ошибкой сайта. Следующий шаг: получить разрешённую схему/возможности AJ для точного count и request-bound evidence причины stale. Подготовленный добор сохранить; без установленной причины не повторять выпуск и не принимать stale данные как свежие.
