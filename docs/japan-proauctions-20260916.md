# ProAuctions public statistics collection — 2026-09-16

User explicitly requested immediate free scraping of https://demo.pro-auctions.ru/statistika/?page=1 and additional sites. No purchase or private interface access.

Probe 35104514275 returned public HTTP200 and pagination links through page400. This does not prove 10000 unique eligible cars.
Saved example https://demo.pro-auctions.ru/statistika/suzuki/swift/30164101.html:
Suzuki Swift2012, TAA Hiroshima4327, auction2026-09-15; source Japan price199000JPY, separately displayed analogous-average200000JPY, Russia delivered930617RUB. Two gallery URLs and a separately marked auction sheet. 1600cc,136hp,137000km. Do not use delivered or average price for auction price.
No explicit sold-status field found in this example. Preserve statistics placement and exact source-price label; do not automatically assert confirmed sale.
Collector scripts/japan-proauctions-sweep.py follows actual public detail links, pagination until exhaustion/time budget, waits1second between requests, stops and saves on errors/access/rate restrictions; chunks250 plus checkpoints; dedup by detail URL. 3hourbudget,200minutejoblimit.
Run https://github.com/jeep-jim/AvtoCena/actions/runs/35105995247 includes saved-fixture assertions before collection. Artifact japan-proauctions-results. publicationReady=false and statisticsCandidate is not qualifiedSoldCandidate.
Additional probes: JapanTransit root403; JP.center root200 with member-login UI (not proof of public finished-lot details); AuctionDataSearch root200 and public statistics link, statistics probe pending.
All modifications on research branch, no production publication.
