# 24.10.2026 — ограниченные чанки общего каталога, рынков и марок

По прямой просьбе владельца остановлен repair 40108157776/job120914067980. GitHub подтвердил cancelled; production-лог дошёл до projections_built, а не до all_projection_written. В этом запуске уже был включён прежний all-only writer, но рынок и марка оставались монолитными. После SIGTERM состояние publication lease пока не прочитано: запуск существующего read-only regcloud-publication-status.yml блокирован автоматической проверкой разрешений. Не сбрасывать неизвестную блокировку и не заявлять успешную пересборку.

Изменение:
- Существующий формат catalog-projection-parts-v1 распространён на public projection/projection-brand и generation indexes/projection/projection-brand. Старый namespace all сохранён побайтно по схеме путей.
- Каждый новый physical part не превышает 1000 строк и 4 МиБ UTF-8 JSON. Лимит применяется до сериализации полного чанка; одна строка сверх лимита вызывает явную ошибку без обрезания данных.
- Async iterable writer записывает части по мере поступления, с backpressure; digest/CAS и публикация root после children сохранены.
- Потоковый parity audit хранит счётчики, а не весь каталог. Чтение частей последовательное, legacy JSON поддержан.
- /api/health сообщает scoped-v1. Workflow проверяет установленный читатель ДО production publication; при старом сервере остановится с catalog_projection_scoped_reader_not_installed.

Ограничение: это исправление размеров сериализованных projection-файлов и потокового parity audit. publishCurrentCatalogReadModels пока сохраняет весь массив компактных projections для построения сортировок/витрин; legacy-shaped search adapter также возвращает массив. Это не полная переработка RAM-модели каталога. Другие вспомогательные индексы не объявлены автоматически переведёнными на чанки. Не удалять swap/heap резерв до отдельной проверки памяти.

Порядок продолжения:
1. Пройти полный CI и установить выпуск с новым читателем; сохранить все requiredResearch/publicResearch/ASTRA requirements из подготовленного coordinated-release-plan, Cupra и остаточный ASTRA.
2. Проверить отменённый writer и его lease read-only; не снимать неизвестную блокировку. Отмена GitHub process сама по себе не доказывает выполнение finally.
3. После подтверждения live health scoped-v1 выполнить ровно одну пересборку с обоими CATALOG_CHUNKED_* flags. Не перезапускать отменённые дневные collectors.
4. Пройти существующие market/manifest/offer guards. Из ранее прочитанного manifest отсутствует Japan: это открытый отдельный blocker, а не основание выключить проверку. Не объявлять полный каталог готовым по одному успешному PUT.
5. Зафиксировать фактические число частей, максимальные bytes, parity и production release. Новый reader нужен для ручного rollback после записи scoped roots; не откатывать на all-only reader без восстановления предыдущих root references.
