

### 17.11.2026 — остановка подготовки до активации, сохранение диагностики

- Prepare-only44055233992 завершился failure09:43:36 на подготовке неактивных индексов, до build/cutover. Все13 exact-sourceCI, source/tree/calculation и retained-index checks были успешны. Фактический child error был утрачен старым обработчиком, сохранился лишь candidate_preparation_failed/Error. Это НЕ доказательство timeout/OOM; unchanged retry без диагностики не выполнялся.
- Controller-only исправлениеcfe83cc35a5ed9ae272ec79c3774c4768918f96b сохраняет очищенные process code/signal/exit/guard-code/byte-counts без сырого stderr/URL/секретов.3testsPASS, лимиты, sourcec7, SHA, writefences, acceptance/rollback не изменены. Новая prepare-only попытка44059198250 выполняется, может переиспользовать уже проверенные части. Установка не подтверждена, health всё ещё83ff/ok.
- Korea44056968938 после успешных authority+50targeted+full regression продолжает restore/archive из43989797288/1. Повторный paid collection не запускался. Дополнительный exhaustive actual-coverage gate подготовлен локально (23testsPASS), но ещё не применялся к результату: нужен завершённый checkpoint artifact и pinned own-storage receipt. До реальной coverage и новых staged-budget checks публикация запрещена.
