## 07.11.2026 — регрессия «Зелёного угла» у дилера: ремонт по скриншотам владельца

Владелец показал /dealers/avtograd?make=Nissan&market=japan&stock=green: заголовок, баннер и выдача сжаты в левую колонку; stock=all сохраняет правую выдачу. Причина в проверенных исходниках: GreenCornerCatalog повторно создавал DealerBrowsingProvider при embedded=true и не выдавал прямой dealer-shared-catalog. Это нарушает селектор #catalog>.dealer-shared-catalog и общую сетку DealerProfileStyles.

PR1717 устраняет именно вложенную обёртку и возвращает общий embedded shell. Самостоятельная /cars/green сохраняет собственную шапку/provider. Расчёты, объявления, фильтры, город, проверка разрешённой Японии и права не меняются. 53 адресные проверки первого запуска прошли, включая новые регрессии embedded/standalone/дилерского допуска; браузерный стенд остановился на конфигурации CSS modules, до проверки вёрстки. Стенд исправляется без удаления проверок. На этой записи новый runtime ещё НЕ опубликован.

PR1716 с одной адаптивной полосой марок прошёл восемь стандартных проверок и объединён коммитом69c9ccca21bb2c865260c775d32261db7c437691. Это объединение кода, не установка. Один согласованный выпуск после зелёных проверок PR1717 и проверки отсутствия действующего deploy; не запускать дубликаты и не отменять здоровые задачи.

Приёмка: исходный URL владельца, переход аукционы→в наличии→назад, прямой вход и перезагрузка; сохранение Nissan/города/<=160/страницы; desktop/tablet/mobile, обе темы; фильтры слева, баннер/карточки справа и реквизиты после каталога, один provider/dock. Изолированный SSR-стенд не заменяет реальные гидратированные переходы после установки. Сохраняются обязательные незакрытые пункты плана07.11: полнота мощности Кореи/Японии, согласованность счётчика, холодная/прогретая скорость и SEO. Не подменять неизвестные характеристики и не отключать источники ради быстрого пустого экрана.

Состояние GitHub на 2026-11-07T10:52:52.212253+00:00:
```json
{
  "1716": {
    "state": "closed",
    "merged": true,
    "head": "97e53be924ce168f00f5f1eb985e0c41ecfb732f",
    "merge": "69c9ccca21bb2c865260c775d32261db7c437691",
    "checks": [
      {
        "run": 42361075621,
        "name": "Verify catalog failure isolation",
        "status": "completed",
        "conclusion": "success"
      },
      {
        "run": 42361075815,
        "name": "Verify green corner budget",
        "status": "completed",
        "conclusion": "success"
      },
      {
        "run": 42361075651,
        "name": "Verify owner UI polish",
        "status": "completed",
        "conclusion": "success"
      },
      {
        "run": 42361075647,
        "name": "Verify catalog sidebar and search",
        "status": "completed",
        "conclusion": "success"
      },
      {
        "run": 42361076004,
        "name": "QR and gallery browser QA",
        "status": "completed",
        "conclusion": "success"
      },
      {
        "run": 42361075718,
        "name": "Verify city picker",
        "status": "completed",
        "conclusion": "success"
      },
      {
        "run": 42361075655,
        "name": "Verify site controls and chat",
        "status": "completed",
        "conclusion": "success"
      },
      {
        "run": 42361075597,
        "name": "CI",
        "status": "completed",
        "conclusion": "success"
      }
    ]
  },
  "1717": {
    "state": "open",
    "merged": false,
    "head": "1de96bc2df0bcdc7ab2499beb54d28b85d57590c",
    "merge": "a1f2f5d4ae37d249cd88177a83b44041c8135823",
    "checks": [
      {
        "run": 42365681540,
        "name": "Verify site controls and chat",
        "status": "in_progress",
        "conclusion": null
      },
      {
        "run": 42365681541,
        "name": "CI",
        "status": "in_progress",
        "conclusion": null
      },
      {
        "run": 42365681542,
        "name": "Verify city picker",
        "status": "in_progress",
        "conclusion": null
      },
      {
        "run": 42365681565,
        "name": "Verify owner UI polish",
        "status": "completed",
        "conclusion": "success"
      },
      {
        "run": 42365681538,
        "name": "Verify green corner budget",
        "status": "completed",
        "conclusion": "failure"
      },
      {
        "run": 42365681531,
        "name": "QR and gallery browser QA",
        "status": "completed",
        "conclusion": "success"
      }
    ]
  }
}
```
