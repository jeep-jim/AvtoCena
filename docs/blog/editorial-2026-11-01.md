# Редакционная проверка — 01.11.2026

Пакет: 10 материалов, из них 2 новые темы и 8 завершённых неопубликованных черновиков 30–31 октября. Это не десять вновь найденных новостей. Публикация через существующий PR1641; старые черновики и адаптации сохранены. Статус установки фиксируется отдельно в roadmap: наличие status=published в seed не подтверждает живую публикацию.

Прочитаны свежие AGENTS.md, roadmap.md и editorial-policy.md. База подготовки: 7043a8f7cbe23c78f18e5647d55cbd0b0654c7b6. На первичной сверке живого /blog только Corolla и Prius; десять выбранных slug там отсутствовали. Доступа к приватным owner drafts нет. Штатный records.ts отдаёт сохранённым в REG статьям приоритет по slug; код и ручные записи не изменяются.

## Факты и даты

Новые темы: полностью электрический финал Car of the Year 2027 (объявление 30.10, подтверждено сайтом организатора; итог ожидается 08.01.2027) и самостоятельный разбор STARIA Cargo (архив анонса 06.10, показ был назначен на12.10). Восемь доработок: BMW Gen6, Tucson N Line, RAV4 PHEV, Land Cruiser FJ, Jeju V2G, IONIQ6 UK, Derek Bell, Taycan E-Shift.

BMW: прежний URL бразильского сообщения перенаправляет на главную. Утверждение о награде удалено; текст перепроверен и переписан по доступному первоисточнику о производстве в Шэньяне15.10.2026. Постоянный slug старого черновика сохранён. У Porsche сейчас дата31.10, поэтому прежняя формулировка о публикации28.10 удалена. История старого черновика сохранена; догадка о причине изменения даты не делается.

Архивные даты явно есть в текстах: FJ20/21.10.2025 (расхождение заголовка и dateline первоисточника), RAV419.02.2026/план09.03, E-Shift12.08, Gen615.10, Tucson12.10, V2G16.10/начало пилота декабрь2025. Не утверждается, что объявленные планы обязательно исполнены. Системная мощность RAV4 не названа мощностью отдельного двигателя. Показатели пробега и зарядки атрибутированы производителю, не собственному тесту.

## Фото

Шесть официальных изображений Toyota/Hyundai скачаны обычным GET с HTTP200 и визуально просмотрены: RAV4, FJ, Tucson, IONIQ3, STARIA Cargo, IONIQ6. Используются только для редакционных статей; авторские подписи и ссылки на условия сохранены. HyundaiEU/UK Terms статьи1–2 разрешают редакционную интернет-публикацию; Toyota Download Agreement разрешает editorial use, запрещая рекламное использование.

Четыре изображения Commons: BMW iX3 (Matti Blume, CC BY-SA4), Taycan (Oleg Yunakov, CC0), IONIQ9 (Damian B Oh, CC BY-SA4), Bell (Brian Snelson, CC BY2). Прочитаны индивидуальные страницы авторства/лицензии, веб-инструмент открыл изображения. В этой среде прямой Python GET к Wikimedia возвращает403, поэтому локальное скачивание и визуальный просмотр этих четырёх не подтверждены. URL уменьшенных копий получены из Commons, не придуманы. Доступность изображений в живой статье нужно проверить после выпуска;403 не обходился. Лицензии, ссылки, архивные даты и оговорки об изображённом исполнении включены в статьи и адаптации.

## Каталог

Шесть точных поисковых URL проверены чтением полного HTML. Taycan: есть реальные ссылки /cars/offer с совпадающей моделью, related ведёт на /cars?market=europe&make=Porsche&model=Taycan; E-Shift в найденных экземплярах не подтверждён и не обещан. BMW iX3: старые исполнения, не подтверждение Gen6. Tucson: корейские Modern2021/2022/2024, не новый европейский N Line. RAV4: найденные лоты помечены проданными, не подтверждение наличия PHEV2026. IONIQ6/9: HTTP200 с текстом ошибки, успешной выдачей не считается. Остальные модели финала и FJ/STARIA отдельно не проверялись, наличие не заявлено, ссылок на них нет.

## Внешние каналы

Подтверждённых каналов Дзена/VK в редакционных документах и доступных инструментах нет. По10 самостоятельных адаптаций для каждой площадки сохранено в docs/blog/syndication/2026-11-01.md. Ничего не отправлено, учётные записи не создавались. UTM-ссылки являются целевыми адресами и не доказательством доступности оригиналов. Перед отправкой проверить оригинал и сохранить фотоатрибуцию.

## Реестр статей и первоисточников

### Семь электромобилей в финале Car of the Year 2027: как читать этот список

Slug: `car-of-the-year-2027-seven-electric-finalists`. Оригинал после установки: https://avtocena.com/blog/car-of-the-year-2027-seven-electric-finalists

- Организатор Car of the Year: финалисты, 30.10.2026: https://caroftheyear.org/news/the-shortlist-for-the-car-of-the-year-2027-award-historic-the-all-electric-car-revolution-has-arrived/
- Hyundai: IONIQ 3 в финале; источник фотографии: https://www.hyundai.news/eu/articles/press-releases/ioniq-3-european-car-of-the-year-2027.html
- Условия редакционного использования фотографии: https://www.hyundai.news/eu/terms-of-use.html

Фото: https://dmassets.hyundai.com/is/image/hyundaiautoever/hyundai-ioniq-3-driving-experience-2026-fierce-red-matte-9972%3ASingle%20Image%20Mobile?hei=398&wid=706

© Hyundai Motor Company / Hyundai Motor Europe. IONIQ 3, один из финалистов; пресс-фото из сообщения 30.10.2026. Редакционное использование по Terms of use, статьи 1–2.

### Электрический STARIA Cargo: как оценить фургон по рабочему маршруту

Slug: `staria-cargo-electric-van-route-guide`. Оригинал после установки: https://avtocena.com/blog/staria-cargo-electric-van-route-guide

- Hyundai: STARIA Cargo, европейский анонс октября 2026 года: https://www.hyundai.news/eu/articles/press-releases/staria-cargo-introduction.html
- Hyundai: список публикаций с датой 06.10.2026: https://www.hyundai.news/eu/press-services/publications/press-releases.html?offset=0
- Условия редакционного использования фотографии: https://www.hyundai.news/eu/terms-of-use.html

Фото: https://dmassets.hyundai.com/is/image/hyundaiautoever/hyundai-staria-cargo-10%3AFeatured%20Content%20Teasers%20%20Mobile?hei=397&wid=706

© Hyundai Motor Company / Hyundai Motor Europe. Электрический STARIA Cargo, пресс-фото из европейского анонса октября 2026 года. Редакционное использование по Terms of use, статьи 1–2.

### BMW Gen6: зачем батарее обходиться без привычных модулей

Slug: `bmw-gen6-battery-800v-2026`. Оригинал после установки: https://avtocena.com/blog/bmw-gen6-battery-800v-2026

- BMW Group: начало серийного производства Gen6 в Шэньяне, 15.10.2026: https://newsroom.bmwgroup.com/global/bmw-group-begins-series-production-of-gen6-high-voltage-batteries-in-shenyang/
- Фотография BMW iX3: автор и лицензия: https://commons.wikimedia.org/wiki/File:BMW_iX3,_IAA_Summit_2025,_Munich_(20250908-P1049824-2).jpg
- Лицензия фотографии CC BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0/

Фото: https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c8/BMW_iX3%2C_IAA_Summit_2025%2C_Munich_%2820250908-P1049824-2%29.jpg/1280px-BMW_iX3%2C_IAA_Summit_2025%2C_Munich_%2820250908-P1049824-2%29.jpg

Matti Blume, 08.09.2025, Wikimedia Commons, CC BY-SA 4.0. BMW iX3 Neue Klasse на IAA в Мюнхене; архивная иллюстрация семейства, не завод в Шэньяне. Уменьшение и кадрирование при показе; изображение сохраняет CC BY-SA 4.0.

### Tucson N Line: спортивное оформление не определяет двигатель

Slug: `hyundai-tucson-n-line-equipment-2026`. Оригинал после установки: https://avtocena.com/blog/hyundai-tucson-n-line-equipment-2026

- Первоисточник производителя; 2026-10-12: https://www.hyundai.news/eu/articles/press-releases/tucson-n-line-paris-motor-show-2026.html
- Условия редакционного использования фотографии Hyundai: https://www.hyundai.news/eu/terms-of-use.html

Фото: https://dmassets.hyundai.com/is/image/hyundaiautoever/hyundai-tucson-n-line-1026-exterior-03%3ASingle%20Image%20Mobile?hei=398&wid=706

© Hyundai Motor Company / Hyundai Motor Europe. Пресс-фото TUCSON N Line из европейского материала октября 2026 года. Редакционное использование по Terms of use, статьи 1–2; права сохранены.

### Японский RAV4 PHEV: как читать данные о запасе хода

Slug: `toyota-rav4-phev-japan-2026-guide`. Оригинал после установки: https://avtocena.com/blog/toyota-rav4-phev-japan-2026-guide

- Первоисточник производителя; 2026-02-19: https://global.toyota/en/newsroom/toyota/43984473.html
- Toyota: условия использования загружаемых материалов: https://global.toyota/en/downloadable-assets/

Фото: https://global.toyota/pages/news/images/2026/02/19/1330/001.jpg

© Toyota Motor Corporation. RAV4 Z PHEV с дополнительным оборудованием, пресс-фото к анонсу 19.02.2026. Редакционное использование по Toyota Download Agreement.

### Land Cruiser FJ: что рассказывал прототип и чего он не доказывает

Slug: `land-cruiser-fj-prototype-guide`. Оригинал после установки: https://avtocena.com/blog/land-cruiser-fj-prototype-guide

- Первоисточник производителя; 2025-10-20/21: https://global.toyota/en/newsroom/toyota/43389422.html
- Toyota: условия использования загружаемых материалов: https://global.toyota/en/downloadable-assets/

Фото: https://global.toyota/pages/news/images/2025/10/21/0500/001.jpg

© Toyota Motor Corporation. Land Cruiser FJ, прототип из пресс-материалов октября 2025 года. Редакционное использование по Toyota Download Agreement.

### V2G на Чеджу: чем отдача энергии в сеть отличается от розетки в машине

Slug: `jeju-v2g-electric-car-grid-2026`. Оригинал после установки: https://avtocena.com/blog/jeju-v2g-electric-car-grid-2026

- Первоисточник производителя; 2026-10-16; pilot since 2025-12: https://www.hyundaimotorgroup.com/en/story/hyundai-motor-group-jeju-v2g-ev-pilot
- IONIQ 9: фотография, автор и лицензия: https://commons.wikimedia.org/wiki/File:Hyundai_IONIQ_9_Calligraphy_ME1_Sunset_Brown_Pearl_(60).jpg
- Лицензия CC BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0/

Фото: https://thumb.wikimedia.org/wikipedia/commons/thumb/4/40/Hyundai_IONIQ_9_Calligraphy_ME1_Sunset_Brown_Pearl_%2860%29.jpg/1280px-Hyundai_IONIQ_9_Calligraphy_ME1_Sunset_Brown_Pearl_%2860%29.jpg

Damian B Oh, 06.10.2026, Wikimedia Commons, CC BY-SA 4.0. IONIQ 9 в Hyundai Motorstudio Goyang, иллюстрация модели; это не автомобиль, идентифицированный в пилоте Чеджу. Уменьшение и кадрирование при показе; изображение сохраняет CC BY-SA 4.0.

### Обновлённый IONIQ 6 в Британии: почему комплектация меняет запас хода

Slug: `ioniq-6-uk-2026-trims-range`. Оригинал после установки: https://avtocena.com/blog/ioniq-6-uk-2026-trims-range

- Первоисточник производителя; 2026-10-29: https://www.hyundai.news/uk/articles/press-releases/ioniq-6-uk-pricing-october-2026.html
- Hyundai UK: условия редакционного использования фотографии: https://www.hyundai.news/uk/terms-of-use.html

Фото: https://dmassets.hyundai.com/is/image/hyundaiautoever/hyundai-ioniq-6-n-line-1125-25%3AImage%20Gallery%20Item%20Mobile?hei=444&wid=767

© Hyundai Motor Company / Hyundai Motor UK. IONIQ 6 N Line, пресс-фото британского анонса 29.10.2026. Редакционное использование по Terms of use, статьи 1–2. Фото не обозначает исполнение Premium.

### Дереку Беллу — 85: почему гонки на выносливость помнят его имя

Slug: `derek-bell-85-let-2026`. Оригинал после установки: https://avtocena.com/blog/derek-bell-85-let-2026

- Porsche: юбилей Дерека Белла, страница и событие 31.10.2026: https://newsroom.porsche.com/en/2026/history/porsche-derek-bell-85th-birthday-43597.html
- Автор, описание и лицензия фотографии: https://commons.wikimedia.org/wiki/File:Derek_Bell_2008_Goodwood.jpg
- Creative Commons Attribution 2.0: https://creativecommons.org/licenses/by/2.0/

Фото: https://thumb.wikimedia.org/wikipedia/commons/thumb/f/fa/Derek_Bell_2008_Goodwood.jpg/1280px-Derek_Bell_2008_Goodwood.jpg

Brian Snelson, Goodwood, 11.07.2008. Derek Bell на Ferrari 312B3 Spazzaneve. CC BY 2.0, Wikimedia Commons; уменьшенная копия, возможное кадрирование при отображении. Архивное фото, не юбилей 2026 года.

### Виртуальные передачи Taycan: что переключает E-Shift

Slug: `porsche-e-shift-virtual-gears-guide`. Оригинал после установки: https://avtocena.com/blog/porsche-e-shift-virtual-gears-guide

- Porsche: 12.08.2026, архивный разбор: https://newsroom.porsche.com/en/2026/products/porsche-e-shift-electromobility-43019.html
- Фотография Taycan: автор, дата и CC0: https://commons.wikimedia.org/wiki/File:A_Porsche_Taycan.jpg
- CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/

Фото: https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c1/A_Porsche_Taycan.jpg/1280px-A_Porsche_Taycan.jpg

Oleg Yunakov, 31.03.2025, Wikimedia Commons, CC0 1.0. Архивная иллюстрация Porsche Taycan; наличие E-Shift на снятом автомобиле не подтверждено. Уменьшение и кадрирование при отображении.
