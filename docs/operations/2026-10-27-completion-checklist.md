# Сверка обязательств из чата — 27.10.2026

> 28.10, 00:10 Красноярск: deploy40539715156 exact592debd FAILURE ДО switch: warm11/11 и35s11/11 PASS;305s health PASS, главная2.1896s>2s FAIL (23PASS+1FAIL; остальные42 не достигнуты). Production exactd418 подтверждён свежимhealth, rollback не требовался.1599/1600 НЕ установлены. Publishedjourney40535167389 не дождалсяruntime, liveшагиSKIPPED. Следующий шаг — измерить главную послеTTL/на смене policyDate; новый deploy без исправления не запускать.

> 27.10, 23:20 Красноярск: production exactd418 установлен66/66+verifier. Единственныйdeploy40539715156 exact592debd выполняется послеfinalCI2648/2648; switch ещёНЕподтверждён. Live d418: mobileHyundai7.835s — скорость не принята.

> 27.10,21:48 Красноярск:1594 merged44fba180(all8PASS),1598 mergedd6f9395(CI2644/2644+types/build и2browserPASS). Единственный releasePR1597 включает обаисправления+1587/1592,готовкзапуску; exactSHA/gates/публикацияещёнеподтверждены. Фактический436послеrollback6fdb. Русскийосмотр/схема готовывкоде,полнаястраховаятаблица/OCRискоростнаяliveприёмканезавершены.

> 27.10,21:40 Красноярск: production436 послеrollback6fdb; русский осмотр1594 merged44fba180,8/8checksPASS, НЕустановлен. Подготовленныйrelease1597 ждёт исправление event-loop fairness чтенияstorage: RED→GREEN/25tests/typecheckPASS, GitHubCIожидается. CPUprofile40518976538SUCCESS; транспорт/разборнагружены, точнаяпричинаhealth389msнеустановлена. Полнаястраховаятаблица/суммы/OCR иliveскоростьостаютсяоткрытыми.

> 27.10,21:16 Красноярск:6fdb rollback после44PASS иpost-switch health389msFAIL; фактический436.1594 exact5877cd6 все8checksSUCCESS, русский структурированный осмотр/схема кузова ещё НЕ установлены.1595 read-onlySUCCESS безOOM/queueerrorsвкандидате, CPU445%настаром; одинCPUprofile40518976538ожидается. История/суммыстрахования иполныйперевод остаютсяоткрытыми.

> 27.10,21:00 Красноярск:40509841163/exact6fdbb5a в Deploy with rollback после успешных build/image/price indexes; switch/gates пока не подтверждены. Следующая правка готовит собственный русский структурированный осмотр и схему кузова (реальный LOT43015054:42поля/замена левого переднего крыла).15 targeted/types PASS, browser/публикация ещё не подтверждены. Это не страховая таблица: события/суммы, полный перевод замечаний и OCR остаются открытыми. Предыдущие статусы ниже — история.

> Актуально27.10,18:25 Красноярск: установлен exact43614d97d82cb64a2f8ccd61187125bfd784bd23;66/66VMsamples PASS, rollback не выполнялся. Deploy40487179302 FAILED после активации на public variant verification. PR1590 merged3364ced проверяет original manifest/mechanical groups без переустановки;40495106401 SUCCESS:532группы/4888вариантов/22635полей на exact43614d9; конфликт проверки разрешён без переустановки. KoreaHyundai live390FAIL / visitor_restricted: полная скоростная приёмка не пройдена. Кнопка Кореи на KIAK5 подтверждена, получение ссылки осмотра покаFAIL. Encyclopedia40495667908: функциональные шаги390/1440PASS, скоростьFAIL (open9,862/7,034с;year3,616/3,684с).1587 с обработкой queue errors merged, но НЕ установлен.1588/1589 закрыты без merge для исключения дублирования. Прежние срезы ниже — история.


> Актуализация аудита27.10: прежние срезы ниже являются историей. Текущий кандидат43614d97d82cb64a2f8ccd61187125bfd784bd23/run40487179302 включает1574 и1567. f27/run40479673544 отклонён доswitch: EuropeBMWAPIafter305s1,1612с>1с;productionпоследнийподтверждённыйe23d. НиоднаUIправканеотмечаетсяliveдоexactSHA. Полныйразбор: [аудитмесяца](2026-10-27-month-performance-audit.md). Дляпоследующейпроверкифильтровнеобходимacceptance:true,390/1440,actualSHA;диагностическийSUCCESSнесчитаетсяприёмкой.

Срез27.10,14:56 Красноярск. Deploy40464735786 exact6aa0df завершился FAILURE до switch: ChinaVWpage2 после305с2,1105с>2с. Production остаётся exact e23d9d0. Loader/scroll, reports и прочие исправления кандидата пока не опубликованы.

| Обязательство | Подтверждено | Осталось до закрытия |
|---|---|---|
| Скорость серверных страниц | Production e23d9d0 ранее прошёл54/54. Кандидат5c3abcd не установлен: после305с China VW page2=2,1047с>2с, old production retained | Следующий exact SHA,60/60 VM warm/35с/305с до/после switch; корректные непустые выдачи |
| Вход «Все» в Китай с выбранным городом | Diagnostic40461122324: digest3776365000 — timeout полной projection/china.json. City ошибочно отключал prepared landing. В1561 исправлен выбор пути;26 targeted tests, RED→GREEN, паритет карточек/цен для3городов и2страниц | Установить и проверить реальное действие с Новокузнецком. Новый URL обязателен в gate≤2с; все каталоги требуют реальные linked cards |
| Нижний полосатый loader | Код1554 уже в main, browser load-more PASS;5c с ним не установлен | Live append точного нового SHA, сохранение карточек, анимация снизу, retry |
| Mobile scroll | Код убирает scroll decoration/touch prefetch; footer passive вне зоны пагинации; fixtures320–1440px PASS | Установка, live mobile scroll/переходы; не выдавать headless fixture за измерение FPS физического телефона |
| Медленные категории/фильтры Кореи |1561 переносит historical SQL cache reads после supplier failure и добавляет Server-Timing | Baseline e23d завершён: mobile35,748с category/20,537с filter; desktop11,167с/12,427с; все выше2с. После установки повторить реальные действия и stage timings, включая budget0items/36,996с |
| Ошибка фильтра сохраняет карточки/параметры | Browser40461967870 PASS:2мин удержания, честная пометка, scope/expiry/empty/retry; новая форма503→200 сохраняет поля и operation ID | Live на установленном SHA. Полный hard RSC/unmount не гарантирует сохранение дерева предыдущей страницы |
| Полный отказ каталога/карточки | Шапка, каталог/главная, контакты, retry и независимая inline-форма с согласием; generic lead не читает отказавшую карточку. Desktop/mobile fixture PASS | Установка и реальная проверка интерфейса; фиктивные заявки в production не отправлять |
| Честная ошибка | «Каталог временно недоступен», без ложного «сайт обновляется» | Не объявлять все старые тексты проверенными |
| Источник Кореи |6 опубликованных HTML ранее содержали Encar.1561 сохраняет доказанный source URL при пустом STATUS того же ID+LOT, без подмены новых фактов | Live новая версия; конкретные отсутствующие ссылки владельца пока не идентифицированы |
| История и осмотр Кореи | Поставщик подтвердил browser/ручную CAPTCHA.1557 включён в1561: paid API, exact LOT/kind, tru.ru, независимые lazy iframe и постоянные new-tab links.40462904544 saved-only SUCCESS: оба лота history fem.encar.com+tru.ru, inspection www.encar.com+tru.ru | Установка и live раскрытие/ссылки. Оригиналы корейские; перевод содержимого и нормализованная русская схема НЕ готовы. Автоматический обход CAPTCHA запрещён |
| Место кнопки | Между «Все характеристики» и «Обновлено» desktop, под характеристиками mobile; browser40461967780 PASS | Подтвердить опубликованный layout |
| Независимые блоки/фото | История и осмотр не запрашиваются до выбора, отказ одного не ломает второй/карточку; fixture PASS | Внешние фото ERR_BLOCKED_BY_ORB в GitHub Chrome остаются ограничением; независимый браузер ранее загружал |
| Запрет регрессий | AGENTS закрепляет whole-action приёмку, неизменные ceilings/rollback, city path, nonempty gate.2623 основной suite+дополнительные suites, types/build и9 browser workflows99f802 PASS | Продолжать обязательную проверку каждого затрагивающего скорость изменения; абсолютной гарантии отсутствия любых будущих регрессий нет |
| Учёт и последовательность | PR1561 merged49e2389d после10 SUCCESS; PR1563 CI40463723945 SUCCESS, merged6aa0df; один deploy40464735786 идёт. PR1548 merged, обе истории сохранены | Дождаться60/60gate и exact runtime, затем live category/filter/append/reports и сравнение с baseline. Не закрывать наблюдение до итоговой проверки |

Проверенные источники: PR1561; CI40461968047; failure browser40461967870; report browser40461967780; saved schema40462904544. Ни пороги, ни цены/данные, ни права/источники не ослаблены.


Исходные замеры текущего e23d: VM/305с40463668481, mobile из того жеrun, исправленныйdesktop40465066921. VM Korea budget36,996с/0items/hasMore=true; China+город12,280с/error HTML; ChinaVW после305с3,641с. Desktop диагностический workflow SUCCESS означает завершение измерения, withinTarget=false для category/filter. Первый40462904526 оборвалсяSSH;1564 исправилkeepalive. Desktop locator исправлен1565, VM не повторялся. Новая6aa0df пока не измерена и не объявлена установленной.


Обновление14:56: warm10/10 и35s10/10 PASS; после305с5PASS, ChinaVW2,1105сFAIL; следующие4URL и всеpost-switch проверки не достигнуты. Old production retained, health подтвердилe23d. Нужен профиль именно VW после305с; повтор установки без исправления не запускать. PR1567 — отдельный draft с незавершённой миграцией/проверками, не принятый следующий выпуск. Подробности и подтверждённая реализация кнопок записаны в Road.


Обновление27.10,15:28: read-only profile40471789360 завершён. Изолированный6aa после305с: VWpage2 1,347с, тёплый0,078с; этот замер не заменяет ранее проваленный gate2,1105с и не подтверждает production. CPUпрофиль содержит повторную safePublicPricing/обработку характеристик при make-only; отдельныйPR1573 устраняет её. Без повторной установки/профиля со стороны этой сессии.

Дополнительная приёмка по последнему поручению владельца (все пункты пока открыты):

| Сценарий | Что проверять на точном установленном SHA | Статус |
|---|---|---|
| Фильтры каждого рынка, включая несколько условий | Марка/модель, цена, год, пробег, мощность, топливо, кузов/привод, сортировка/сброс; правильные карточки и счётчик, город/назад; время до видимого результата и число запросов на390/1440px | Не пройдено; Korea baseline выше цели |
| Локальное ожидание фильтра | Прежние карточки и текущий выбор остаются; нет полосы в шапке даже при streaming и Enter; видимый статус у фильтров | Новый код,8 targeted tests/types PASS; GitHub browser ожидается |
| Категории всех рынков | Холодная/тёплая/истёкшая выдача, непустые правильные машины, city-only не читает полный рынок | Итоговая liveприёмка не пройдена |
| Пагинация и карточка→карточка→назад | Нижняя анимация, append/retry, scroll/history, без фоновых запросов от touchscroll | Код/fixtures ранее есть, live нового SHA не принят |
| Фото и расчёт | Независимость фото от расчёта; итог соответствует актуальным параметрам/курсу/городу; время до результата, отсутствие лишнего пересчёта соседних карточек | Не закрыто, фотоORB в GitHub браузере — известное ограничение |
| Корея | Источник, независимые история/осмотр, manual CAPTCHA/newtab, честный корейский оригинал | Код готов, установка/live/русский перевод не завершены |

Скрытый индикатор не означает устранение задержки. Полный список комбинаций фильтров не объявлять проверенным по нескольким примерам; сохранять реальные параметры/измерения, расширять сценарии по найденным сбоям.


Текущий единый выпуск:40474031727 exact7d40825041e2d642829d4f4dfa0884be5eec27b8; prepare/storage integrity выполняется, switch не подтверждён. После PR1572 обязателен также /cars/autocatalog≤2с с1–40реальными строками: всего66samples, прежние10URL/потолки не ослаблены. PR1574 локальных фильтров в этот SHA НЕ входит; отдельную параллельную установку не запускать. Local52 filter/sort/budget/supplier tests PASS, ownerUI40474025276 наc014f77 PASS390/1440; окончательный head/полный sidebar browser и liveещё требуют проверки.


Уточнение15:58: city40475112653 attempt2 job122096644964 SUCCESS (Chromium+WebKit), все8проверок PR1574 exact3846316 SUCCESS. Repair40475679501 действительно исправил433модели/1505добавленныхколлизий, originalsPreserved:true; required_research_batches_verified PASS57batches/1209variants/1832fields/15identityFields. Затем FAILURE на astra_revision_existing_value_changed:icePowerKw:00624e6c77b6541109a32d66:88d9a0095604c289e773cc32. Это следующий блокер проверки цепочки записей, не доказательство причины медленной страницы. Повторныйrepair/deploy этой сессией не запускался. Production остаётсяe23d. Для устранения постоянных конфликтов параллельных журналов Road/checklist публикуются отдельно от кода1574, сохраняя обе истории; финальная интеграция кода требует актуального head и checks.

## Дополнение 27.10, 19:59 — русская форма и ожидание справочников

- Подготовлено: AjesCatalog не ждёт необязательные модели/марки перед карточками; независимые rail/count streamed, существующие полные справочники в контролах остаются. RED→GREEN на зависшем metadata,29 targeted/typecheck PASS. Production эффект пока не измерен.
- Подготовлено частично: русский разбор явно указанных текстовых полей осмотра по exact LOT из разрешённой ссылки, без автоматического Korean iframe. Реальный42514287 дал только два признака осмотра. Полная страховая история/суммы/body diagram/OCR не готовы; не закрывать задачу по этим двум признакам.
- Блокер данных: публичный insurance summary с проверяющего адреса вернул blocked page; нельзя обходить отказ, использовать чужой токен/адрес или выдавать отсутствие данных за отсутствие страховых случаев.
- Повторный реальный SsangYong page2 API503 visitor_restricted7,400с. Не считать исправлением интерфейса устранение этого отказа. После CI/browser нужен один согласованный кандидат с1587, затем unchanged66VM и реальные390/1440 category/filter/append/reports.

## 27.10, 22:30 — новое поручение и проверенные расхождения

- [ ] Korea Rexton «Все» из других рынков: реальный переход, повторные клики, локальное ожидание,390/1440,≤2с. Код local navigation подготовлен, live не принят.
- [ ] Japan AWD + Новокузнецк:24 не считать полным количеством; частичная выдача с retry; точный cursor/page2/append, неизвестные приводы не угадывать. Подготовлено исправление ложного конца списка; вся сохранённая таблица lookup/SQL проверена, полный ассортимент не принят.
- [ ] Count не блокирует готовые карточки: RED→GREEN Korea/Japan; после установки подтвердить реальные времена и count независимо.
- [ ] Энциклопедия главная: canonical missing-field priority подготовлен; durable card↔knowledge↔encyclopedia tests PASS. Распространение исправления уже заполненного значения/инвалидизация индексов по точной технической связи пока НЕ готово.
- [ ] Технические факты локально, feed для актуальных listing/price/photo/withdrawal и идентичности: найти/устранить повторные detail reads, без удаления ценовых/источниковых guards.
- [ ] Дождаться единственного40524826437/d418,66VM+live; новая fix/catalog-navigation-drive-20261027 ветка требует своих checks и следующего согласованного выпуска.


22:40: PR1599 draft finala9473e2, CI40532904410/browser40532904260 pending. Original368b183 12browser/verify SUCCESS, локально2647/2647+types. Runtime d4184b5/40524826437 выполняет Deploy with rollback; switch/66samples не подтверждены. Эти документы не новый runtime. Следить за обоими кандидатами; полнота AWD и canonical propagation заполненных карточек остаются открытыми.


23:00: d418 exactinstalled,66/66VM/publicverifierPASS. Live40535343374:390 category1.618s/filter7.835s,1440category1.849/filter0.827;24correctcards/noheader/retention/noJS PASS, общий strict2sFAIL. Подготовлен один следующий runtime с1599; приёмка толькопосле установки. Canonical filled-field propagation,полнотаAWD иinsurance cases/sumsНЕготовы.


23:09: в ещёНЕзапущенный1600 добавлен management preview fullAJESrecord reuse (24→0 redundant detail reads,8targeted+typesPASS); финальныйCIдоmerge. ЯпонскийownerURLнаd418воспроизведён24cards+ложныйконец/6.660s,1599fixпокаНЕустановлен. Cityintegrationcancelledдоbrowserнаpackageinstall;повторёнтолькоjob.


23:20: PR1600 merged592debd, final9da CI40538052257+3checksSUCCESS. Единственныйdeploy40539715156 идёт. PR1599 integrationcityretrySUCCESS. Liveafterinstall требуетactual592,обаwidths,acceptance:true; networktraceтеперьсохраняетactualnavigationtimings бездобавочныхзапросов. Japan reference378rows→370unique keys,295single/49ambiguous/26unknown,0missing/drivediff. Canonicalfilledpropagation/полнотаdrive/fullinsurance/all-marketliveНЕзакрыты.


### 28.10.2026, 00:10 Красноярск — выпуск592 не активирован: главная после305с превысила2с

Проверены фактические jobs и полный журнал [deploy40539715156](https://github.com/jeep-jim/AvtoCena/actions/runs/40539715156), prepare122314956089. Exact кандидат592debdccff24387fbc05979d08ed501b198889d успешно прошёл research/coverage/security/storage, Docker build/image и подготовку exact price indexes. В шаге Deploy with rollback and resource measurements до переключения: warm11/11 PASS, after35s11/11 PASS, after305s health0.0058s PASS, затем главная /2.1896s при2.0000s FAIL. Итого23PASS+1FAIL из обязательных66; оставшиеся9 pre-switch и все33 post-switch не выполнены. Ошибка performance_budget_exceeded:/ в scripts/regcloud-performance-gate.py:78. В00:02:02.721 Красноярск журнал явно сообщает «Release gate failed: old production retained». Переключения и отката с592 не было; final public verifier не запускался.

Свежий публичный /api/health после отказа подтверждает exactd4184b5d2acb88264eef114bb5f9e013997d99c8. Поэтому1599/1600 (локальный переход «Все», честная неполная пагинация, независимый count, management-preview reuse) пока НЕ установлены. Установленныйd418 и его прежние66/66 сохраняются; его mobileHyundai7.835s остаётся незакрытой live-проблемой, результаты старого live не повторялись.

Подтверждённые VM времена кандидата: / warm0.2314s,35s0.9072s,305s2.1896s; /cars warm0.1493s/35s0.1695s; ChinaVWpage2 warm0.0815s/35s0.0618s; China+Новокузнецк0.0648s/0.0683s; autocatalog1.1474s/0.2722s. Холодная подготовка отдельно: home10.431s,repeat0.345s,totalRub24.007s. Эти замеры не доказывают скорость пользовательских действий и не заменяют отсутствующие post-switch/live.

[Published journey40535167389](https://github.com/jeep-jim/AvtoCena/actions/runs/40535167389), job122298340892 завершился FAILURE в23:52:52 на Wait for exact published release: Production release or verified descendant not confirmed после3600s. Ожидалсяd6ba6cc или подтверждённый потомок; основные mobile/desktop шаги SKIPPED. Это отсутствие установки ожидаемой версии, не падение браузерного сценария на592. Повтор не запущен. На проверке GitHub нет in_progress workflows; новые deploy/repair/сборщики/диагностики этой сессией не запускались.

Следующее исправление требует изолированного разбора главной на exact592 после305с с фазами snapshot/overview, counts, pricing, dealer/rail и фактическими storage/CPU timings. Временная граница существенна: warm/35s были27.10 23:56,305s —28.10 00:01–00:02. Нужно проверить и expiry, и переход policyDate, а не объявлять любой из них причиной без трассы. В exact592 homepage всё ещё ждёт withAjesCount; эта функция ждёт count/page по активным AJES рынкам, тогда как1599 снял count-await внутри readAjesCatalogPage. Это подтверждённая зависимость кода, но вклад именно в2.1896s не измерен. Предыдущий dated overview reader уже поддерживает текущую дату: нельзя без доказательства объявлять её отсутствующей. Пороги, числоURL, цены, данные и guards не менялись; слепой rerun установки не выполнялся.

Открыты: liveRexton «Все»,JapanAWD2страницы/append и полнота доказанных кузовов, все рынки/фильтры/цены/город/back/photos, русские страховые события/суммы и liveосмотр, revision-linked распространение исправлений заполненных фактов энциклопедии. Наблюдение сохранено; это отчёт о неуспешной установке последнего кандидата, не итоговая приёмка всего поручения. Локальные worktrees сохранены без reset/discard; их прежний общий gitparent сейчас отсутствует, поэтому документы читаются/публикуются по GitHub API с expected-parent CAS.



### 28.10.2026, 00:54 Красноярск — изолированная главная592: холодная8.467с, после305с0.894с; причина исходного отказа ещё не локализована

[Диагностика40553637289](https://github.com/jeep-jim/AvtoCena/actions/runs/40553637289), job122363723540 SUCCESS. Уточнение времени предыдущей записи00:50: GitHub run фактически стартовал00:45:50, контейнер00:46:24; запись00:50 описывала подготовку/наблюдение, не timestamp запуска. Exact592: cold8.467s, warm0.436s, after35s0.482s, after305s0.894s. Все4HTTP200,полныйHTML~879KB,безstreamError; это диагностический результат, не полный66gate/live/nonempty acceptance. Исходный gate2.1896s не воспроизведён и не отменён. Полночь и последовательность всех11URLs исходногоgate здесь не воспроизводились.

CPU5секунд вокруг последнего GET:2406samples,2243idle,8GC. Окно содержит время вне самого0.894sзапроса; нельзя превращать долюidle в точную загрузку CPU только во время запроса.27outboundGET:catalog11,dealer4,overview2,other5,features/stock/source-controls/rates/market-settingsпо1. Все200,18–212ms,безошибок; это категории, не доказательство повторов одинаковогоobjectkey. В этом измерении нет свидетельства длительнойCPUнасыщенности; остаются сетевые зависимости/холодная подготовка. Server-Timingглавной отсутствует, поэтому доляsnapshot/count/pricing/rail отдельно не измерена. catalogTimingsвконце — хвост журнала контейнера, включаяпредыдущиезапуски, не привязыватьегоавтоматически кэтомуcoldGET.

ProductionSHAдо/после совпалd4184b5d2acb88264eef114bb5f9e013997d99c8. Кандидатостановлен00:52:28.943,Statusexited/ExitCode0/OOMKilledfalse; лимит2CPU/8GiB, observedmemory0.64–1.06GiB. Ниактивации,ниотката,ниновойустановкинебыло. Нельзяобъявлятьготовность592поудачномуизолированному0.894s.

Следующий минимальный шаг: фазовые timings именно холоднойhomepage и cached metadata/count/pricing/dealer dependencies с сопоставлением policyDate/generation, затем устранение подтверждённойлишнейработы; не запускатьтотжепрофильилиdeployпо кругу. Необязательныйcount outerwithAjesCount пока остаётсякодовойзависимостью, анеустановленнойпричиной2.1896s. Сохраняютсявсеоткрытыеlive/1599/1600/AWD/canonical/insuranceзадачи. Наблюдениенеотключено.


### 28.10.2026, 04:00 Красноярск — PR1601 принят; подготовлен один изолированный образ для фазового замера

PR1601 merged aa307caabeb7b238732fd654eb247254a2eb2f0c после всех четырёх SUCCESS exact ea519: CI40576103015/job122442836050 — 2649/2649, дополнительные suites, web/engine types и production build; green40576102986, site40576102989, Dubicars40576103024 также SUCCESS. Это opt-in измерения восьми этапов, не ускорение. Свежий health остаётся exact d418; runtime сайта не переключался.

Добавлен отдельный одноразовый workflow regcloud-home-phases с immutable source aa307, baseline stopped592 и expected production d418. Docker собирается на GitHub runner без production credentials. Точный частный calculation-v1 копируется из остановленного592, проверяется digest моделей и совпадение байтов внутри нового образа; новая энциклопедия/сборщик/repair/exact-price preparation не запускаются. Приложение имеет новый exact source SHA и собственный calculationVersion, а не выдаёт себя за592; поэтому это инструментированный фазовый замер, не повтор исходного gate на идентичном cache context. Проверка diff требует только два runtime-файла инструментирования относительно592; остальной runtime неизменён.

На VM общая release concurrency и обе runtime/prepare locks, ожидаемый production SHA, отказ при другом активном кандидате, loopback-only случайный порт, 2CPU/8GiB, restart=no, абсолютный600s deadline. Ровно четыре полных GET главной cold/warm/35s/305s. Контейнер останавливается и удаляется в finally при успехе/ошибке/SSH hangup; nginx не редактируется, его байты и production SHA сверяются до/после. Печатается только whitelist фаз, длительностей и технических идентификаторов; секреты, содержимое отчётов и raw logs не выводятся. Никаких production activation/rollback или снятия66 gates.

Проверка Python/YAML/bash syntax PASS; пять локальных tests PASS: exact stopped baseline, отказ при сменившемся production до create, сохранение runtime guards, очистка контейнера/env при start failure, whitelist логов. Маркер предназначен для одного нового фазового измерения; прежнюю40553637289 не повторять. Build и результат VM ещё ожидаются. Следующий шаг — по фактическим фазам устранить доказанную лишнюю работу; не называть outer counts доказанной причиной до журнала. Все открытые live/all-markets/AWD/canonical/insurance задачи сохранены.


### 28.10.2026, 04:08 Красноярск — номер единственного фазового запуска и границы измерения

[Isolated home phases40582674878](https://github.com/jeep-jim/AvtoCena/actions/runs/40582674878), job122465929770, фактически стартовал03:57:56 Красноярск (20:57:56UTC27.10); заголовок04:00 выше — округлённое время записи плана, не timestamp запуска. Проверки immutable target и runtime diff прошли; общий шаг Build one instrumented image and measure without activation ещё in_progress. Завершение Docker build, четыре GET,32 записи восьми фаз и финальная остановка пока не подтверждены. Active job log BlobNotFound404 не считается failure. Не запускать дубликат или production deploy.

Дополнительно проверен exact код withAjesCount: внутри одновременно ожидаются readAjesCountSummary и readAjesCatalogPage для активных AJES рынков; функция заменяет соответствующие карточки, а не только числа. Поэтому простое удаление outer await может потерять карточки Кореи и не является допустимым исправлением. Фаза counts измеряет этот составной этап целиком; если он окажется медленным, отдельно различить получение карточек и метаданных, не приписывать всё счётчику без данных. Новый calculator context изолированного aa307 явно отличается от592; любые наблюдения интерпретировать с этим ограничением. Результата ускорения или нового установленного выпуска пока нет; наблюдение и весь остаток поручения сохранены.


### 28.10.2026, 04:51 Красноярск — холодная главная локализована до snapshot, без изменения production

[Фазовый запуск40582674878](https://github.com/jeep-jim/AvtoCena/actions/runs/40582674878), job122465929770 SUCCESS, завершён04:09:25. Exact instrumented aa307 с сохранённым индексом592: cold9.9081s/warm0.3443s/35s0.5175s/305s0.8944s; четыре полных HTML~834KB,32 успешных записи восьми фаз. Cold snapshot8743.2ms (около88% полного времени); counts64.6ms, catalogPricing683.0ms, greenPricing760.1ms, green297.6ms, dealer305.5ms, japanRail38.4ms, dealerRail270.5ms. Параллельные фазы не складывать как последовательные. Snapshot warm8.0/35s145.0/305s349.0ms. На305s counts59.7ms, catalogPricing304.5ms, greenPricing302.8ms, dealer218.2ms, dealerRail154.7ms, japanRail25.3ms. Generation gen_1793052425373_c710a778 и policyDate2026-10-28 одинаковы во всех четырёх запросах. Counts не был главным холодным ожиданием в этом запуске.

Контейнер exited/exit0/OOMfalse; stop/remove и удаление отдельного diagnostic image завершились успешно. Production SHA до/после exactd4184b5d2acb88264eef114bb5f9e013997d99c8, nginx bytes unchanged; свежий публичный health04:48 такжеd418. Никакого switch/rollback. Не отменяет исходный592gate2.1896s: другой calculationVersion, не воспроизведены midnight и11URLпоследовательность. Это не приёмка пользовательской скорости/66gates и не доказательство полного устранения задержек.

Код snapshot включает загрузку editorial, manifest/overview, возможный fallback полной projection и дополнительные поиски рынков со скрытыми редактором объявлениями. Какая из этих внутренних ветвей дала8743ms ещё не измерено. Следующий минимальный read-only шаг — максимум6 чтений metadata (manifest до/после, immutable/dated/public overview, editorial), без fullprojection/provider/build/preparation. Вывод только numeric completeness/counts/hidden counts и generation/date fences; при смене поколения не переносить вывод на прежний замер. Скрипт использует существующие publication/completeness helpers, Node syntaxPASS,180sdeadline. Отдельный marker запускает одну проверку; предыдущие профили не повторяются. Сейчас активен штатный China refresh40584157800 — не дублируется и не изменяется. Все незакрытые AWD/canonical/insurance/live и неустановленные1599/1600 сохраняются.


### 28.10.2026, 04:54 Красноярск — bounded metadata подтверждены, следующий участок: editorial пересчёты

[Metadata40590216978](https://github.com/jeep-jim/AvtoCena/actions/runs/40590216978), job122492206576 SUCCESS04:52:14. Шесть read-only object reads, без full projection/provider/VM/build. Expected gen_1793052425373_c710a778 сохранился; manifest до/после побайтово в JSON одинаков. Immutable и dated overview соответствуют28.10 и generation; выбран immutable. Public alias имеет другую дату, но не нужен при валидном immutable. Все market completeness checks PASS: China244471/24rows; Japan0/0; Korea9910visible/9926source/24; UAE23511/24; Europe46127/24; Georgia1705visible/1706source/24. Это показатели prepared metadata, не новый сбор inventory. Metadata read durations с GitHub: manifest817ms, immutable2620ms, dated708ms, public359ms, editorial219ms, manifestafter223ms; не VM и не времена предыдущего cold запроса.

Editorial hiddenEntries: Japan2/UAE4/Europe2, остальные0. Exact storage.ts readHomeCatalogSnapshot после prepared snapshot последовательно вызывает searchOffers для каждого рынка с editorialHasHidden, включая нулевую локальную Японию. Это доказанная зависимость кода и текущих metadata; вклад этих searches в8743.2ms отдельно ещё не измерен. Нельзя объявлять отсутствие datedoverview причиной, или считать текущую валидность overview историческим доказательством его состояния04:03. Следующее узкое исправление/проверка: исключить заведомо пустой market из ненужного editorial search с регрессией нулевого/непустого рынка, затем отделить timings manifest/overview и hidden-market searches; сохранить точные counts/withdrawals/editorial revisions, не подменять их оценкой. Не повторять40582674878/40590216978 без нового исправления. Нового production release нет; d418 и все незавершённые задачи остаются.


### 28.10.2026 06:44 Красноярск — PR1602 принят, один изолированный замер вложенных этапов

PR1602 merged 00799e55bd4a8294e0518076665d64cc29816a64 после exact4c0ab527 all4 SUCCESS: CI40601688922/job122531108807 — 2652/2652, дополнительные suites, web/engine types и production build; green40601688979, Dubicars40601688812, site40601688786 SUCCESS. Узкий guard пропускает повторный editorial search только при строгом нуле и отсутствии карточек рынка. Это не доказанный выигрыш всех8.74s. Свежий health06:43 exactd418; production не переключён,1599/1600 ещё не установлены.

Подготовлен один новый isolated home-phases run: source exact00799, baseline stopped592, expectedproductiond418. Runtime diff разрешает только прежние homepage/helper и новые storage/home-editorial-empty; нет новых research/index preparation. Parser принимает вложенные snapshot phases, сохраняя обязательные32 core rows/four traces/eight phases. Privacy allowlist, loopback/locks/600sdeadline/2CPU8GiB/cleanup и production/nginx fences сохранены. Python/YAML/bash syntax и5 safety tests PASS. Marker запускает замер нового кода cold/warm/35/305 без activation; новая calculationVersion ограничивает сравнение cache context. Активный штатный China40584157800 не дублирован. Старые40582674878/40590216978 не повторяются. Итог нового run ещё ожидается; фазовые доли и ускорение нельзя утверждать до журнала. Все открытые live/AWD/canonical/insurance требования сохранены.


28.10.2026 06:45 Красноярск: запущен [единственный isolated home-phases40604129004](https://github.com/jeep-jim/AvtoCena/actions/runs/40604129004), job122539279137 in_progress. Immutable target прочитан; checkout source выполняется. Source00799, expectedproductiond418. Build и измерения пока не подтверждены; это не production deploy. Не запускать дубликат; дождаться журнала вложенных фаз и cleanup.


### 28.10.2026 07:28 Красноярск — вложенные фазы00799: задержка в двух последовательных editorial searches

[40604129004](https://github.com/jeep-jim/AvtoCena/actions/runs/40604129004), job122539279137 SUCCESS06:55:49. Exact00799: cold8.4240s,warm0.2967s,35s0.5350s,305s1.1053s; четыре полных HTML~834KB безRX. Все60phase rows ok (32core+28nested), generationgen_1793052425373_c710a778/day28.10 одинаковы. Cold manifest85.8ms/overview136.2ms/prepared224ms; editorial UAE4316.9ms затемEurope2615ms; Body7157.6ms,Context7294.4ms,outerSnapshot7294.6ms. Counts30ms,catalogPricing625.5ms,greenPricing825.5ms. Ни Japan editorial search, ни fallback snapshotProjection не исполнялись. Холодные UAE+Europe6.9319s составляют измеренную основную задержку snapshot. Нельзя считать всю разницу с прежним9.9081s результатом skip: calculationVersion/момент запуска различаются.

После305s: manifest60.2ms,overview133.7ms,UAE125.5ms,Europe3.2ms,snapshot455.2ms. Контейнер exited0/OOMfalse; удаление контейнера/образа и workflowcleanup завершены; productionbefore/after exactd418/nginxunchanged. Свежий health07:26 такжеd418. Ни switch, ни rollback; исходный592gate2.1896s не отменён, midnight/11URL/liveприёмка не воспроизводились. Повтор этого завершённого замера не запущен.

Следующее адресное изменение: ограниченно параллельные независимые editorial searches (максимум2), применение результатов в прежнем порядке. Это устраняет измеренную последовательную зависимость, но не убирает саму стоимость4.3s/2.6s и не обещает cold<=2s. Точный total/карточки/скрытия/ошибки и число запросов сохраняются. Необходимы CI, изолированное сравнение ресурса/времени и неизменные66gates до установки; весь незакрытый AWD/canonical/insurance/live scope остаётся.


### 28.10.2026 09:18 Красноярск — PR1603 принят; один изолированный замер параллельных поисков

PR1603 merged a32fc8f22a387fbb7c290b0f395f898d4a02a975 после exacte7f1349929491810a5a28efb56a777b30997b1ec all4SUCCESS: CI40617116732/job122582091714 (полный regression, дополнительные suites, web/engine types, production build), green40617116653/site40617116782/Dubicars40617116655. Последующая штатная overview preparation40619529836 SUCCESS; дубликат не запущен. Health09:14 exactd418. Изолированный probe sourcea32fc8,baseline592,expectedproductiond418 использует прежний exact privateindex, новые calculationVersion и boundedparallel2; marker меняется один раз. Активных release/repair/diagnostic/collector при проверке нет; активные UI/CRM проверки не дублируются. Это новая проверка изменённого кода, не повтор завершённого00799. Production activation не выполняется; все32core/fourtraces, privacy/locks/cleanup/nginx/production fences и ресурс2CPU8GiB сохранены. Build/результат замера ещё ожидаются, ускорение не объявляется.

Владелец снова подтвердил задержки главной/категорий, работающий русский осмотр и неработающую страховку. Camry197hp/estimate58/пустоеICE и неверная подсказка ДВС разобраны в отдельномPR1604; он ещё не установлен. Полная страховая история, точное revision-linked распространение энциклопедии, AWD и live390/1440 всех рынков остаются открытыми. После замера — дальнейшее исправление стоимости searches при необходимости, единственный release с неизменными66gates и реальная приёмка. Watch не отключён.


### 28.10.2026 09:24 Красноярск — точный Seltos history и конфликт мощности в Camry

Один GET карточки Seltos из скриншота установил exact offerId ajes-korea-6izYHdWbwKT4O0/LOT43019707. Один GET нашего Korea history API вернул HTTP429 report_unavailable за4.757827s. В route этот статус объединяет refusal/cooldown; подробную причину и причину браузера владельца не установить из этого ответа. Никаких повторов, иных IP/токенов или обращения к ранее отказавшему publicsummary не было. Русский осмотр подтверждён владельцем, но history parser для событий/сумм отсутствует, поэтому страховая история не принята.

Один read-only public GET /api/encyclopedia/76f504335c4103fa35725836?year=2024: revision2e5776af-4cf5-4906-b63c-d5ead9c35746,22строки. Hybrid1987cc: вариантыdf0e50f14f05c52c62a36498/f7c07ce5c8096fda926411ec имеют powerHp197 одновременно powerKw111.8, icePowerKw пусто; a74562b7e55633fe8526d151 —197/144.89,ICE также пусто. Значения197hp/111.8kW не являются согласованной парой единиц. Нельзя механически переносить111.8вICE или переписывать197: нужны семантика и доказательство конкретного годового варианта. Текущий официальный https://www.gac-toyota.com.cn/download/configpdf/camry.pdf относится к2026: 2.0hybrid ICE112kW/system145/motorpeak83. Он подтверждает различие понятий, но сам по себе не доказывает характеристики карточки2024. Сохранённый reported precedent58 не становится certified из-за наличия этой спецификации. Производственные значения не менялись.

Следующий canonical этап должен адресно разделять ICE/system/30-minute, связывать подтверждённые факты с годовым техническим вариантом и revision; обновлять именно наследованные значения с сохранением ручных исправлений/конфликтов, инвалидировать affected calculation/search. Нельзя называть текущий immutable index или missing-only полноценным двусторонним доминированием. Это зафиксированная фактическая причина необходимости проверки данных, не завершённое исправление.

[Isolated probe40620019450](https://github.com/jeep-jim/AvtoCena/actions/runs/40620019450), job122591516376, sourceexacta32fc8 выполняется: target/runtime diff PASS; build/measurement ещё ожидаются. Не запускать параллельный deploy или повтор. PR1604 headf5e962d19ab14f645f84f9e53c1d8a26b6fed267 содержит исправление misleadingICEподсказки и запись нового поручения; 3localtestsPASS,6UIchecksSUCCESS,CI40619863833 на production build. Новая установка не выполнена.


### 28.10.2026 09:35 Красноярск — новый отказ Kia Seltos; результат a32fc8 и принятая правка Camry

Владелец прислал скрин реального отказа /cars?market=korea&make=KIA&model=Seltos&source=ajes&city=Новокузнецк: вместо карточек общий unavailable. Это подтверждённый пользовательский сбой, не только ограничение проверяющего адреса. Один последующий внешний HTML GET этого адреса:200,11.784819s,24уникальные ссылки и все24Seltos,noRX. Следующий отдельный API GET:200,8.293936s,24Seltos,stale:true,total:null,hasMore:true. Server-Timing:catalog-total3219.4ms,query-resolution681.4,supplier-read1580,detail-cache-sum4502.7,enrichment-sum5,count2102.2,pricing600.5. Detail-cache-sum/параллельныефазы не складывать как критический путь; сетевое время не приписывать backend. Успех сохранённой выдачи не отменяет отказ владельца и не является приёмкой скорости. Не повторять эти запросы без изменения/причины.

Нужен один read-only закрытый журнал production за02:19–02:24UTC/09:19–09:24Красноярск (скрин02:21:47): не более5000строк, только фиксированные categoryMentions безURL/IP/SQL/текстов/содержимого. Эти mentions не уникальные события/посетители и сами по себе не доказывают причину конкретного запроса. Новый отдельный marker/workflow запускает только этот журнал; нет каталог/provider requests, build, profiler, nginx edit или restart. Exactproductiond418 before/after, nginxbytes fence, runtime-change lock,5minworkflowdeadline. Pythoncompile/privacy/empty и YAML/bashsyntaxPASS. Старые диагностические окна/профили не повторяются, активные browser checks не дублируются. Результат ещё ожидается.

[40620019450](https://github.com/jeep-jim/AvtoCena/actions/runs/40620019450)/job122591516376 SUCCESS09:28:06. Sourcea32fc8: cold6.9053s/warm1.1223s/35s0.4724s/305s0.9925s,4completeHTML~834KB,60/60phaseok(32core28nested),4roottraces,samegen1793052425373_c710a778/day28.10. Coldmanifest66.9ms/overview32.6/prepared101.5; UAE4857ms иEurope5470.4ms перекрываются, Body5573.3/Context5800.6/snapshot5800.8;counts67.4/catalogPricing684.9/greenPricing764.5. Тёплыйsnapshot6.7ms,ноgreenPricing955.7ms; после305snapshot399.9ms. Поиски по отдельности дольше прежних4316.9/2615ms, возможно конкурируют за ресурсы; точная причина удлинения не измерена. Нельзя выдавать параллелизм за устранение стоимости: cold всё ещё6.9s, новаяcalcVersion/no midnight/no11URL/no live. Exit0/OOMfalse,cleanupSUCCESS,productiond418/nginxunchanged. Новый productiondeploy не запускался. Следующий performancefix должен убрать повторное чтение/пересчёт подготовленных редакторских выдач на запросе посетителя, с exactgeneration/day/editorialrevision и паритетом карточек/count/withdrawals; не ослаблять66gates.

PR1604 merged8a2b7cf279337643923d40a19944886e38fd3bea после final792a8035c2d968f4e4fb823523e3b2060b42f367 ALL7SUCCESS: CI40620747962/job122593888578 regression/extras/webengine types/build, owner40620747801/gallery40620747793/city40620747788/site40620747914/green40620747959/Dubicars40620747968. Originalf5e962 также7SUCCESS,2656testsPASS. Интеграция изменила только документы, обе истории Road сохранены. UI разделяет ICE и30мин, не исправляет ещё конфликтные значения Camry и не делает страховую историю готовой. Production по-прежнемуd418;1604 и предыдущие1599/1600/1602/1603 не установлены. Watch включён, полная canonical/insurance/AWD/liveприёмка не закрыта.


### 28.10.2026 09:47 Красноярск — закрытое окно отказа Seltos и границы последующих зелёных проверок

[Closed owner incident40621846213](https://github.com/jeep-jim/AvtoCena/actions/runs/40621846213), job122597486858, SUCCESS09:35:59. Закрытое окно02:19–02:24UTC содержит1369строк. Фиксированные упоминания: local_busy224, visitor_restricted212, request_timeout3, invalid_response6; raw queue_timeout/full и object-storage timeout/request-failed по0. Это **упоминания, не уникальные запросы или посетители**. Трассы конкретного запроса владельца нет; нельзя приписать его экран одному из кодов. Production before/after exactd4184b5d2acb88264eef114bb5f9e013997d99c8, nginx unchanged. Повтор окна или запросов каталога не запускался. Свежий отдельный health такжеd418.

Основная интерактивная работа исправляет AJES admission-queue fallback: в текущем коде отказ очереди приходит снаружи provider try/catch и превращается в local_busy, минуя чтение saved query. Это подтверждённая кодовая зависимость; исправление ещё не опубликовано/не принято. В наблюдении не создавались параллельные runtime PR, repair, deploy, сборщики или VM diagnostics. Требования к исправлению: сохранённая выдача только для точного допустимого запроса, прежние сроки/identity/source switches/withdrawals/ценовые проверки, честный stale/partial, без повышения очереди или обхода поставщика.

[CRM40621680823](https://github.com/jeep-jim/AvtoCena/actions/runs/40621680823) SUCCESS: audit122596962356 явно пишет «No production deployment requested by this commit; audit the current release» и видитd418. Live122598918921 сообщает36cases/168openings/passed, но это проверка опубликованного текущего сайта, **не установка и не live-приёмка1604**. [Attached parameters40621680689](https://github.com/jeep-jim/AvtoCena/actions/runs/40621680689), job122596962386: types/regressions/build, component fixtures и pickup fixtures PASS; ещё ждёт requested release/verified descendant, опубликованный шаг не исполнен. Не запускать дубликат и не объявлять эту очередь browser failure.

Уточнение записи09:35: интеграция PR1604 меняла **Road/checklist и диагностический marker**, всего3файла; runtime поправки интерфейса не менялся. Сохранены обе истории. PR1604 merged, но1599/1600/1602/1603/1604 по-прежнему не установлены. Сбой владельца, медленная главная/категории, полный insurance, exact revision-linked canonical propagation и AWD остаются открытыми. Наблюдение включено.


### 28.10.2026 11:05 Красноярск — ожидания опубликованного релиза завершились; runtime не обновлён

Свежий health: exact d4184b5d2acb88264eef114bb5f9e013997d99c8. До этой записи main оставался6ab455f, новых PR после1604 и активных workflows при проверке нет. Исправление queue fallback закреплено за основной интерактивной работой; отдельный runtime PR/repair/deploy/diagnostic в наблюдении не создавался. Отсутствие опубликованного PR не доказывает отсутствие локальной работы.

[Attached40621680689](https://github.com/jeep-jim/AvtoCena/actions/runs/40621680689)/job122596962386 завершился FAILURE09:53:10: после900s ожидания «Production release or verified descendant not confirmed». Фактический EXPECTED_RELEASE в журнале —40d15f34bc4f7bfd9d0bf23a1d171193d23f6a00, полученный workflow из последнего коммита deploy marker; это не SHA1604. До ожидания types/regressions/build PASS, fixture48cases/228openings PASS, pickup six markets390/1440 PASS. Published petrol/hybrid step не исполнен. Это отказ подтверждения установки, не падение браузерного сценария1604. Не повторять до установки и согласования actualSHA.

Дополнительно разобран [mobile overlay40619529878](https://github.com/jeep-jim/AvtoCena/actions/runs/40619529878)/job122589896521: FAILURE09:33:49 внутри catalog-budget-live.mjs на вызове wait-published-release.mjs, та же ошибка неподтверждённого релиза. Types/build, Chromium14fixtures, WebKit14fixtures и390/1440 dark/light multi-model/city fixtures PASS. Live budget assertions ещё не начались; последующие published steps SKIPPED. Не считать этот статус доказательством нового отказа Japan budget, успешной live-приёмкойa32fc8 или основанием повторного deploy.

Существующие проверки и профили не перезапускались. Все незавершённые требования скорости/устойчивости, canonical propagation, AWD и страховой истории остаются открытыми. Следующий шаг по текущему поручению — завершение основного queue fallback с регрессией и CI, затем согласованный release с неизменными66gates и реальными390/1440 interactions. Наблюдение включено.


### 28.10.2026 12:10 Красноярск — PR1605 принят, один выпуск исправления отказа каталога

PR1605 merged ef538d508dda08b9c91238c8d24f83cb1884c7eb после exact head4b6804986befe3baa033ed6439b4d0a0ea660116: CI40635331554/job122640879399 — 2662/2662, дополнительные suites, web/engine types и production build PASS; green40635331570, Dubicars40635331485, site40635331487 SUCCESS. Локально89/89, новая регрессия RED4FAIL→GREEN6PASS. При queue timeout/full list восстанавливается из допустимых сохранённых данных без provider-запроса вне очереди; stale/partial, сроки, рынок/страница, фильтры и source switch сохранены.

По интерактивному «исправляй» запрошен один новый выпуск с этим исправлением и уже принятыми1599–1604. Предыдущий592 не перезапускается. Перед запуском нет активного deploy/repair/diagnostic/collector; отдельная штатная green-проверка merge не меняет production. Свежий health в этой сессии: exactd4184b5d2acb88264eef114bb5f9e013997d99c8. Marker меняет только reason/requestedAt, все research/ASTRA списки сохранены. Релиз собирается из commit маркера, runtime совпадает с mergeef538d. Все66 server gates и rollback остаются прежними; installation/switch и новые live timings ещё не подтверждены.

Это выпуск исправленной устойчивости и накопленных проверенных изменений, а не объявление полной скорости. Последний изолированный probe1603 cold6.9053s остаётся неудовлетворительным; его повтор не запускался. Для следующего ускорения нужен подготовленный результат дорогих editorial searches с привязкой к generation/day/editorial revision и контексту расчёта, с проверкой обоих путей построения overview (обычный и датированные страницы). Отсутствие overview не является установленной причиной. Страховые суммы/случаи, Camry ICE/30-min provenance, canonical filled-field propagation, AWD и полная live-приёмка всех рынков открыты. Наблюдение включено. Live очередь — только после exact installed SHA, старые failed-wait workflows не повторять автоматически.


### 28.10.2026 12:12 Красноярск — ID единственного выпуска

[Regcloud deploy40636411536](https://github.com/jeep-jim/AvtoCena/actions/runs/40636411536) запущен для exactd1ba21202b43579abfc2ee69160f5801cfe798ea. Первый job122644288390 wait-for-astra in_progress: checkout/setup завершены, npm ci выполняется; ASTRA gate, build/image,66server gates и switch ещё не подтверждены. Не запускать второй release/repair/diagnostic. Следующая проверка — фактический результат этого run, затем exact health и одна очередь live только после установки. Все ограничения записи12:10 сохраняются.
