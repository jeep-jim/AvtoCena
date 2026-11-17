

### 18.11.2026 — Яндекс Директ удалён по прямому требованию владельца

- Владелец подтвердил: автоматических сборов/выгрузок для Яндекс Директа не должно быть. Это не относится к Yandex Cloud или каталогу автомобилей.
- Main32d3f0d удалил `.github/workflows/yandex-direct-feed.yml` со всеми cron/push/workflow_run/manual triggers и `scripts/publish-yandex-direct-feed.mjs`; 5 профильных тестов PASS.
- Exact stop-controller44202359957 SUCCESS: Direct #474/run44201644747 и #476/run44201857408 подтверждённо cancelled. #474 успел обработать green498, итогового feed-report нет; #476 не стартовал jobs. Запуск рекламной кампании этот код не выполнял.
- Main4fbf1175 удалил рекламный route `/feeds/yandex-auto`, Direct feed/scenario modules и рекламный fallback карточки/metadata. Saved/client/shared сценарии сохранены; 5 share regression tests и TS/TSX syntax PASS. Remote bytes сверены.
- Это source cleanup, НЕ установленное приложение: live83 и срочный China data-only release не изменялись. Остальные CI ещё проверяются; полный build и live route retirement не объявляются завершёнными. Удалённые исторические feed-объекты в storage не чистились.
