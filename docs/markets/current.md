# Текущий шаг

Checkpoint: **28.11.2026, Asia/Krasnoyarsk**. Ошибка Японии «до 160 л.с.» → сортировка по цене исправлена и опубликована; счётчик возвращён. [Выпуск №34](https://github.com/jeep-jim/AvtoCena/actions/runs/46095339210) — **SUCCESS / accepted / completed / published**. Реальная проверка сайта и повторное открытие пользовательской ссылки после установки прошли.

## Исправление и точная версия

- Runtime **`20fd18d12b3f5c7aabef860e1b53da0d505dfd64`**, tree **`b3257c801b2b26cc84ec8d37380a2d8ec120b431`**, ветка `fix/japan-price-sort-count-20261128`. Предшественник и сохранённый rollback — принятый B9 `b9e9122b75f4e588088d0241476b18df7f047d96`.
- Точная дельта — **11 файлов**, SHA256 `8e5a3d15adeec0f78c073e982f30fe1a2278b1e6462d2ec81dad13ac12280515`. Pricing `64c6338e0db23c8999096bceefbf113c0136fe15` сохранён; 116 путей накопленной совместимости проверены по точным байтам. Защищённые формулы, CRM и логика других рынков новой дельтой не изменены.
- При power-фильтре и сортировке по итоговой цене сырой порядок `FINISH` больше не вытесняет подходящие автомобили из ограниченного чтения. Рассчитанная цена выбранного города сортируется внутри загруженной страницы и группы известной/неизвестной мощности. Глобальная сортировка всего источника между страницами не заявляется.
- Счётчик показывает подтверждённое точное количество, когда оно есть; иначе — реально загруженное число и явный статус неполного подсчёта. Append увеличивает число, смена query сбрасывает его к новой выборке; поздний старый aggregate игнорируется. Неизвестный total не становится нулём.
- Пустой interrupted/partial/stale ответ сохраняет предыдущие полезные карточки с существующим статусом ошибки. Правила мощности, ручные сведения, энциклопедия, город, исходные SQL-модули, бюджеты чтения и TTL сохранены.

## Завершённая проверка

- [Hosted Verify №71](https://github.com/jeep-jim/AvtoCena/actions/runs/46094827437) — **SUCCESS**, attempt1, controller **`c2992bef3dd5c2ffcbf076b61501f8f07b7a2a87`**. **1727/1727 controller**, **563/563 native**; fail/cancelled/skipped0. Все обязательные функциональные шаги5–15 и 9 browser artifacts прошли; ZIP digests сверены с GitHub.
- Настоящий Chrome: оба режима controls, power checkbox → дороже → дешевле → append, счётчики **24 → 24 → 24 → 48**. Подтверждены цены выбранного города, разные ID следующей страницы, сохранение48 при ошибке/ожидании, новая query→24, игнорирование позднего старого счётчика; page errors0.
- Проверены байты **159 runtime sources**, включая **13 CSS**, настоящий CatalogSidebar и generated component CSS. Helper SHA256 `96c57d1f0cae2f9281060efbc8635fbefa21400b2d70fe19f1834d0d2690c69f`. Price report SHA256 `227724040c62edf7d371b3712e1b14afe597012bd41269f0330a1a13d55189c3`; независимый review PASS.
- Это fixture с контролируемыми локальными ответами: production/supplier/forbidden requests0. Проверку опубликованного сайта он не заменяет. Отказы68–70 были исправленными ошибками runner/caller, отсутствовавших стилей и substring ID locator; их доказательства сохранены в подробном отчёте.

## Принятая публикация и проверка сайта

- [Выпуск №34](https://github.com/jeep-jim/AvtoCena/actions/runs/46095339210): trigger **`7f25a16f0faa3559d7239a6579009fb29de09289`**, approved parent **`c2992bef3dd5c2ffcbf076b61501f8f07b7a2a87`**. Отдельный marker-only push; runtime20fd и retainedB9 закреплены в code plan.
- Установленный image **`sha256:52a88419257d9002b8b505787f4708b995f1e2d70caafd430cae9796156661b6`** привязан к runtime20fd/treeb325; image roundtrip и protected pricing PASS. Terminal cycle подтверждает `accepted/completed/published`, `retentionPreserved=true`, `leaseReleased=true`; B9 image защищён как current/rollback.
- Реальный Новокузнецк: checkbox160 → DESC → ASC → append, счётчики **24 → 24 → 24 → 48**, HTTP200, точное совпадение карточек и порядка с API, цены выбранного города, разные ID следующей страницы; page errors0. `japanPriceSortRequired`, `japanPriceSortPassed`, `japanCountDisplayPassed` и все 16 прежних Japan functional gates — **true**. Nonce и generation manifest совпадают с accepted cycle; ZIP SHA256 `5ebb24f273915990910a69ac7b5cc355da8bd4304811653ee7e0264496a726f1` проверен.
- Независимое обычное обновление точной пользовательской ссылки после установки: **24 карточки**, выбран DESC и checkbox160, виден текст **«Загружено 24 · количество уточняется»**, прежнего сообщения о недоступном списке нет. Общий точный total по этому фильтру не заявляется. Проверка с нулём карточек во время установки предшествовала activation phase02:08:33UTC; она сохранена в истории отчёта.
- Время только наблюдается по `japan-functional-observed-timing-v1`; бизнес-перепроверка соседних рынков не требуется. Source dump/mirror, дополнительные supplier scans и подмена IP не применяются.
- Текущий accepted generation по terminal report — **`gen_china_46077223993_1`**, manifest `bdc53a25146a9a181c84c3b7fde2d3576ede0147b9e4cc70a4ad0788e1e022b7`; [плановый daily №7](https://github.com/jeep-jim/AvtoCena/actions/runs/46077223993) принял его до этого выпуска. Его manifest, source timestamp/cursor и pricing runtime совпадают с release34; прежний doc с generation `gen_china_45875678028_1` описывал более раннее состояние. В выпуске34 `sourceRequests/generationWrites/priceCalculations/encyclopediaWrites/otherMarketWrites=0`. Отдельного predecessor accepted-state snapshot в uploaded artifact нет. Daily base сохраняет принятый B9, принятый20fd выбирается по accepted state; исторические профили и predecessorA5 сохранены.
- [REG №12](https://github.com/jeep-jim/AvtoCena/actions/runs/46067152151) ранее завершил конечную очередь (`completed=true`, `pending=0`, `leaseReleased=true`). Прежний AJ bounded pass/cron сохранён; эта правка не запускает нового обхода/очистки.

[Точные bindings, история исправлений verifier и доказательства](../operations/2026-11-28-japan-price-sort-count-release.json). [Предыдущий итог и обслуживание](../operations/2026-11-27-japan-directory-completion.json).
