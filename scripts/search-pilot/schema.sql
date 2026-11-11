-- Disposable derived index. Never run against production.
CREATE TABLE search_pilot_generation (generation text PRIMARY KEY, ready boolean NOT NULL, UNIQUE(generation,ready));
CREATE TABLE search_pilot_active (singleton boolean PRIMARY KEY CHECK(singleton), generation text NOT NULL,
 ready boolean NOT NULL DEFAULT true CHECK(ready), FOREIGN KEY(generation,ready) REFERENCES search_pilot_generation(generation,ready));
CREATE TABLE search_pilot_offer (
 generation text NOT NULL REFERENCES search_pilot_generation, city text NOT NULL,
 id text COLLATE "C" NOT NULL, make text NOT NULL, model text NOT NULL, year integer,
 power double precision, price double precision, PRIMARY KEY(generation,city,id),
 CHECK(price IS NULL OR price>0), CHECK(power IS NULL OR power>0)
);
CREATE INDEX search_pilot_price ON search_pilot_offer(generation,city,price,id) WHERE price IS NOT NULL;
CREATE INDEX search_pilot_make_price ON search_pilot_offer(generation,city,make,price,id) INCLUDE(power) WHERE price IS NOT NULL;
CREATE INDEX search_pilot_model_price ON search_pilot_offer(generation,city,make,model,price,id) INCLUDE(power,year) WHERE price IS NOT NULL;
CREATE VIEW search_pilot_visible AS
 SELECT o.* FROM search_pilot_offer o JOIN search_pilot_active a ON a.generation=o.generation
 JOIN search_pilot_generation g ON g.generation=o.generation AND g.ready;
