### 40.30. KB ChaChaCha Korea: access-policy qualification останавливает автоматический crawl

- **Дата checkpoint:** 2026-09-04. Следующий новый candidate после закрытия Good Car pagination-пакета.
- **Цель:** до исследования detail/pagination отдельно проверить, разрешён ли сам публичный маршрут для автоматического каталога. KB ранее был `research_pending`/list-only candidate с полезными public search signals, но без доказанного permitted automated route.
- **Bounded probe:** run `33826631629`, head `5be42c80545baa4ce79e0a7425128322d061fb76` — `success`; artifact `9920244140`, digest `sha256:4f4c66bb38a28870c4b8fce53e5cc9313397f148f4a2a52d81574d7254fa265f`.
- **Жёсткий request envelope:** ровно `2` HTTP-запроса — `robots.txt` и registry-declared `https://www.kbchachacha.com/public/search/main.kbc`; `detailRequests=0`, `paginationRequests=0`, `externalScriptRequests=0`, raw bodies не сохранялись.
- **Live access facts:** `robots.txt=200`, observed robots policy для registry route разрешает доступ; public search page также `200`. Но в **видимом официальном public HTML** обнаружен явный запрет несанкционированного scraping/automation. Robots allowance не трактуется как отдельное разрешение при наличии такого ограничения самого сайта.
- **Решение:** `kbchachacha_korea_candidate -> class=lead_only`, `publishAllowed=false`. Текущий scope — только ручной поиск/reference navigation; automated inventory ingestion, pagination/detail crawl и публикация карточек из этого public route запрещены в нашем движке.
- **Важно:** это не означает, что данные KB плохие. Источник отклонён именно как текущий автоматический ingestion route. Requalification возможна при появлении официально разрешённого API, partner/dealer feed или письменного разрешения на автоматическое использование.
- **После permitted-access requalification:** заново доказать offer identity/direct URL, KRW price, body, fuel/powertrain, exact engineCc, exact power, mileage и listing-bound gallery. Public-page scraping нельзя использовать как обход.
- **Safety:** `productionWrites=false`, `publishAllowedMutations=false`, `objectStorageWrites=false`, `catalogGenerationWrites=false`, production catalog/generation/manifest/cleanup не менялись.
- **Evidence:** `docs/catalog-source-kbchachacha-access-policy-v1-evidence.md` и `data/catalog/source-partial-classification-v1.json`.
- **Следующий шаг:** не тратить запросы на KB без разрешённого data route; продолжить квалификацию следующего `research_pending` source, сохраняя тот же no-write/source-permission-first порядок.
