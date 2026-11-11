## 07.11.2026 — продолжение после обрыва ответа: исправление дилерского «Зелёного угла» сохранено

Повторно проверены PR1716/1717, их фактический diff и результаты проверок. PR1717 исправляет лишний DealerBrowsingProvider и отсутствующий прямой dealer-shared-catalog при embedded=true; standalone-режим сохранён. Все шесть стандартных workflow точного head3f3a870834a746fb3cacade4553585fbde121099 завершились SUCCESS. Исправление и одна адаптивная полоса марок PR1716 объединены, но слияние не считается установкой.

Единственный действующий выпуск —393/run42367668990, ожидаемый application release a5f9a645835ae636ab99dd1a7b1073ba24d851b4. Дополнительный deployment в этой сессии не запускался; release marker и формулы не менялись. Уже запущенный readback42367789665 ожидает завершения именно этого выпуска и проверяет исходный дилерский URL, реальный SPA-переход аукционы↔в наличии, город/марку, ширины1440/1024/390 и публичную единственную полосу марок. Результат браузерного прогона нужно прочитать, а снимки осмотреть до объявления live-приёмки.

Тестовый снимок green-1600-dark показывает исправленную геометрию на изолированных данных, не установленный сайт. Прямая сеть из текущей среды недоступна; это не вывод о доступности сервиса, проверка ведётся внешним runner. Состояния ниже получены на указанную дату напрямую из GitHub и публичного health, не из старого сообщения.

Главные незакрытые обязательства плана07.11 сохраняются: точное сопоставление мощности Кореи/Японии с проверенными вариантами, полнота<=160 и согласованность счётчика, устранение intermittent/cars, холодные/прогретые замеры, ошибки сети и полная SEO-приёмка. Не называть весь сайт быстрым/исправным по одному CI или HTTP200. Источники, права, энциклопедия/ручные данные, цены/пошлины/комиссии и сроки свежести не изменяются этим контрольным действием.

Контроль на 2026-11-07T11:44:10.437025+00:00:
```json
{
  "PR1716": {
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
  "PR1717": {
    "state": "closed",
    "merged": true,
    "head": "3f3a870834a746fb3cacade4553585fbde121099",
    "merge": "318c039ee20ebbf1ec862139c1c21eb42d8f6ed7",
    "checks": [
      {
        "run": 42366466801,
        "name": "Verify site controls and chat",
        "status": "completed",
        "conclusion": "success"
      },
      {
        "run": 42366466796,
        "name": "CI",
        "status": "completed",
        "conclusion": "success"
      },
      {
        "run": 42366466811,
        "name": "Verify owner UI polish",
        "status": "completed",
        "conclusion": "success"
      },
      {
        "run": 42366466775,
        "name": "Verify green corner budget",
        "status": "completed",
        "conclusion": "success"
      },
      {
        "run": 42366466835,
        "name": "QR and gallery browser QA",
        "status": "completed",
        "conclusion": "success"
      },
      {
        "run": 42366466806,
        "name": "Verify city picker",
        "status": "completed",
        "conclusion": "success"
      }
    ]
  },
  "deployment": {
    "run": 42367668990,
    "head": "a5f9a645835ae636ab99dd1a7b1073ba24d851b4",
    "status": "in_progress",
    "conclusion": null,
    "jobs": [
      {
        "name": "wait-for-astra",
        "status": "completed",
        "conclusion": "success",
        "activeSteps": []
      },
      {
        "name": "prepare",
        "status": "in_progress",
        "conclusion": null,
        "activeSteps": [
          "Prepare exact price indexes before activating the release"
        ]
      }
    ]
  },
  "liveReadback": {
    "run": 42367789665,
    "head": "8487964ab86b4948c44ea826251afc77fc4b3628",
    "status": "in_progress",
    "conclusion": null,
    "jobs": [
      {
        "name": "readback",
        "status": "in_progress",
        "conclusion": null,
        "activeSteps": [
          "Wait for the one corrected deployment, without starting another release"
        ]
      }
    ]
  },
  "health": {
    "ok": true,
    "releaseSha": "11e3b4ed853518731c11aa1522068cc87cbb8ff4",
    "calculationVersion": "3dfe8fe83a3d281ccfaf415cc6cb8ce627d08893d1c499b34014c20f807ecde4"
  }
}
```
