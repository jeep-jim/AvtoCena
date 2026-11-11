# AvtoCena — canonical market sources

This file is the permanent source-of-truth for vehicle catalog collection. Do not add, replace or silently enable sources unless the project owner explicitly requests it.

## UAE

- Dubizzle — https://uae.dubizzle.com/
- DubiCars — https://www.dubicars.com/

Price rule: use the positive listing price and source currency.

## Korea

- Encar — https://www.encar.com/
- K Car — https://www.kcar.com/

Price rule: use the positive listing price and source currency.

## Europe

- mobile.de — https://www.mobile.de/
- AutoScout24 — https://www.autoscout24.com/

Price rule: use the positive listing price and source currency.

## Georgia

- MyAuto — https://www.myauto.ge/
- AutoPapa — https://autopapa.ge/

Price rule: use the positive listing price and source currency.

## China

- CHE168 — https://www.che168.com/
- Dongchedi — https://www.dongchedi.com/
- Guazi — https://www.guazi.com/
- Autohome new cars only — https://www.autohome.com.cn/

Price rule: use the positive listing price for used/dealer listings. For Autohome new cars, use the official positive vehicle price exposed by the source. Do not publish “price on request”.

## Japan

- JPAUC past auctions — https://jpauc.com/auction/past
- CarVector auction statistics — https://carvector.com/stat
- Prestige Motorsport auction results — https://prestigemotorsport.com.au/auctions/
- Auction Data Search — https://www.auctiondatasearch.jp/
- JP Center — https://jp.center/

Mandatory Japan rule:

- only completed historical auction lots;
- only confirmed sold/completed lots;
- only a positive final sale/hammer price;
- current auctions, upcoming auctions, start prices, current bids, expected prices and unsold lots are forbidden;
- the stored `sourcePrice` must represent the final sale price and the price type must be `auction_final`.

## Common publication contract

A listing may be published when it has a real source ID, real source URL, make, model, year 2011 or newer, positive source price, source currency and at least one real photo. Store up to 30 source photos.

Power, engine displacement, fuel, transmission, drivetrain, customs calculation and vehicle-knowledge enrichment are optional at collection time and must not block publication. Missing fields may be enriched later, but source-provided values must not be overwritten by inferred data.
