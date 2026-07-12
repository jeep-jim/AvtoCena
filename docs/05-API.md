# API

## Публичный трекинг

```text
POST /api/cpa
```

Публичный browser-to-server трекинг событий `visit` и `calculation_completed`. Записывает только атрибуцию и технические параметры без персональных данных.

Поддерживаются:

```text
clickId
externalClickId
partnerRef
sub1-sub5
utmSource
utmMedium
utmCampaign
utmContent
utmTerm
```

События дедуплицируются по типу события, внутреннему `clickId` и `calculationKey`.

```text
POST /api/leads
```

Создаёт клиента, заявку, событие CRM и исходящее CPA-событие. Сохраняет полную атрибуцию, параметры расчёта и источник заявки.

```text
GET /api/avtocena
GET /api/health
```

## Защищённые чтения

```text
GET /api/leads
GET /api/cpa
GET /api/partners
```

Доступны только соответствующим внутренним ролям или по CPA-ключу. Персональные данные лидов не выдаются публично.

## CRM

```text
GET /api/crm/clients
POST /api/crm/clients
PATCH /api/crm/leads/:id
```

`PATCH /api/crm/leads/:id` позволяет назначить менеджера, изменить статус и добавить внутренний комментарий. Для статусов `rejected` и `duplicate` причина обязательна.

Изменение статуса формирует запись в `data/cpa/events*.json`. Если для `partnerRef` настроен активный адаптер в `data/cpa/networks.json`, CPA Gateway сразу пробует отправить S2S-postback. При ошибке событие остаётся в очереди со статусом `failed` и временем следующей попытки.

## Исходящая доставка CPA

```text
POST /api/cpa/deliver
```

Служебный endpoint для повторной доставки событий `pending`, `failed` и `waiting_config`. Доступен администратору или по `CPA_DELIVERY_SECRET`.

Конфигурация сетей хранится в:

```text
data/cpa/networks.json
```

Пример записи:

```json
{
  "id": "network-example",
  "name": "CPA Network",
  "enabled": true,
  "partnerRef": "network_code",
  "method": "GET",
  "postbackUrl": "https://network.example/postback?click_id={click_id}&status={status}&lead_id={lead_id}&payout={payout}",
  "payoutRub": 10000,
  "timeoutMs": 5000,
  "statusMap": {
    "new": "pending",
    "in_progress": "pending",
    "rejected": "rejected",
    "duplicate": "rejected",
    "contract_signed": "approved"
  }
}
```

## Входящий callback

```text
GET /api/cpa/postback
```

Не является основным способом подтверждения договора. Используется только для редких входящих callback или тестов конкретной сети и работает лишь при заданном `CPA_POSTBACK_SECRET`.

## Запрос выплаты прямого партнёра

```text
POST /api/partners/payout-request
```

Создаёт заявку на выплату в `data/partners/payout-requests*.json`, запрещает второй активный запрос и отправляет уведомление в служебный Telegram. Для CPA-сетей этот endpoint не используется: расчёты идут по реестру сети.
