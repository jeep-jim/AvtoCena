# Подготовка budget selectors после сбоя304b270

Выпуск40117114655/job120940688218 завершился до установки:24.10.2026 18:25:43UTC, PUT budget-markets-v2/china.json размером79,256,913байт прерван транспортом. Причина abort сверх текста лога не установлена. ASTRA/index/build прошли; live остаётся8ec0d858.

PR1529 устраняет лишний legacy rewrite: проверяет v3 по непустым рынкам immutable manifest и каждому checksum/count/generation, не требует локального AJES Japan. Отдельный liveJapan preflight, публичная приёмка всех6рынков, race/integrity guards сохранены. При необходимости новые v3 объекты ограничены4MiB и verified readback предшествует ready. Превышение лимита завершает операцию ДО записи: требует отдельной поддержки частей, не увеличения timeout. Старыеv1/v2 остаются для совместимости/rollback; установленный8ec0d858 уже читаетv3.

Для фактического решения после CI/merge: существующий regcloud-publication-status marker с inspectBudgetSelectors:true читает текущие directory/parts и выдаёт requiredMarkets,valid,bytes,rows,otherRows. При valid=true новый backfill переиспользует индекс без полной перезаписи. При valid=false исследовать фактические размеры/состав и не запускать заведомо падающий повтор.

Локальные проверки:18целевыхтестов,2521общийрегрессионныйтест иweb/engine typecheckPASS. CI/merge и live installation фиксируются отдельной записью после факта. Этот документ не подтверждает установленное исправление, полностью boundedRAM, globalAJESorder, DBX или скорость.
