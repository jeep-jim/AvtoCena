# JSON Schema

Все данные проекта хранятся в `data/*`.

## Чанки

Один файл содержит максимум 500 записей.

Пример:

```text
data/leads/leads.json
data/leads/leads-0002.json
data/leads/leads-0003.json
data/leads/leads-index.json
```

`leads-index.json` хранит количество записей, лимит и список чанков. Чтение коллекции объединяет чанки автоматически, начиная с самых новых записей.

## Lead

Ключевые поля заявки:

```json
{
  "id": "lead_uuid",
  "clientId": "client_uuid",
  "status": "new",
  "statusHistory": [],
  "assignedManagerId": null,
  "brand": "Toyota",
  "model": "Harrier",
  "budgetRub": 3000000,
  "searchRequest": {},
  "attribution": {},
  "createdAt": "ISO date",
  "updatedAt": "ISO date"
}
```

## Client

Карточка клиента сразу подготовлена под будущую генерацию договора:

```json
{
  "fio": "",
  "phone": "",
  "telegram": "",
  "email": "",
  "birthDate": "",
  "passport": {
    "series": "",
    "number": "",
    "issuedBy": "",
    "issuedAt": "",
    "departmentCode": ""
  },
  "registrationAddress": "",
  "residenceAddress": "",
  "inn": ""
}
```

## Attribution

```json
{
  "clickId": "internal click id",
  "externalClickId": "CPA click_id",
  "partnerRef": "partner code",
  "sub1": "",
  "sub2": "",
  "sub3": "",
  "sub4": "",
  "sub5": "",
  "utmSource": "",
  "utmMedium": "",
  "utmCampaign": "",
  "utmContent": "",
  "utmTerm": ""
}
```
