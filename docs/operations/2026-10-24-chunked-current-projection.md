# 24.10.2026 — исправление сериализации общего каталога

Запуск 40104679690/job120903797449 прочитал 324275 записей, построил directory indexes и завершился 15:24:04 UTC с storage_json_serialize_failed:path=catalog/public/projection/all.json:Invalid string length. RSS последнего успешного этапа 1717379072 байт; это не прежний heap OOM. Общий alias не был заменён из-за ошибки до PUT.

Причина: writeCatalogProjectionParts существует, но CATALOG_CHUNKED_ALL_PROJECTION_WRITE не задан в workflow. Включается существующий формат catalog-projection-parts-v1 по 1000 записей с digest/CAS и записью root после children. Установленный по health выпуск8ec0d858 содержит reader (проверен его исходный commit), как и готовящийся7189a40f. Изменений расчётов, источников, допуска рынков или данных нет.

Проверки:10 storage/parts/publisher тестов PASS; отдельно11 publisher/policy тестов с флагом1 PASS; diff-check PASS. Повтор production repair следует выполнять после завершения активной подготовки7189a40f/40103448997, без конкурирующей публикации. Отсутствие Japan в immutable manifest не объявлено исправленным; market gate не ослаблен. Следующие результаты нужно дописать в Road.
