import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, normalizeTerm, readJson, writeJson } from "./lib.mjs";

const EEA_REPORT = path.join(WORKSPACE_ROOT, "reports/model-eea-europe-2020-2025.json");
const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/model-eea-reviewed-aliases-01.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/models-eea-reviewed-aliases-01-2026-08-17.json");

function folded(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const rule = (sourceBrandId, modelId, patterns) => ({ sourceBrandId, modelId, patterns });
const reject = (sourceBrandId, reason, patterns) => ({ sourceBrandId, reason, patterns });

const MAP_RULES = [
  rule("audi", "audi/rsq3", [/^RS Q3\b/]),
  rule("audi", "audi/rsq8", [/^RS Q8\b/]),
  ...[3, 4, 5, 6, 7].map((number) => rule("audi", `audi/rs${number}`, [new RegExp(`^RS ${number}\\b`)])),
  ...[2, 5, 6, 7, 8].map((number) => rule("audi", `audi/sq${number}`, [new RegExp(`^SQ ?${number}\\b`)])),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((number) => rule("audi", `audi/a${number}`, [new RegExp(`^A ?${number}\\b`)])),
  ...[2, 3, 4, 5, 6, 7, 8].map((number) => rule("audi", `audi/q${number}`, [new RegExp(`^Q ?${number}\\b`)])),
  rule("audi", "audi/e-tron-gt", [/^E TRON GT\b/]),
  rule("audi", "audi/e-tron", [/^E TRON\b/]),

  rule("bmw", "bmw/i3", [/^I3S?\b/]),
  ...[4, 5, 7, 8].map((number) => rule("bmw", `bmw/i${number}`, [new RegExp(`^I${number}\\b`)])),
  ...[1, 2, 3].map((number) => rule("bmw", `bmw/ix${number}`, [new RegExp(`^IX${number}\\b`)])),
  rule("bmw", "bmw/ix", [/^IX\b/]),
  ...[2, 3, 4, 5, 6, 8].map((number) => rule("bmw", `bmw/m${number}`, [new RegExp(`^M${number}(?:$|\\s)`)])),
  ...[
    [1, "16|18|20|23|25|28|35|40|50|60"],
    [2, "14|16|18|20|23|25|28|30|35|40"],
    [3, "16|18|20|23|25|28|30|35|40"],
    [4, "18|20|25|28|30|35|40"],
    [5, "18|20|23|25|28|30|35|40|45|50"],
    [6, "20|30|35|40|45|50"],
    [7, "25|28|30|35|40|45|50|60"],
    [8, "40|50|60"],
  ].map(([series, suffixes]) => rule("bmw", `bmw/${series}-series`, [
    new RegExp(`^(?:SERIE ${series}|SERIJA ${series}|${series} SERIE|${series} SERIES)\\b`),
    new RegExp(`^(?:M ?)?${series} ?(?:${suffixes})[A-Z]*\\b`),
  ])),
  ...[1, 2, 3, 4, 5, 6, 7].map((number) => rule("bmw", `bmw/x${number}`, [new RegExp(`^X${number}\\b`)])),
  rule("bmw", "bmw/xm", [/^XM\b/]),
  rule("bmw", "bmw/z4", [/^Z4\b/]),

  rule("mercedes-benz", "mercedes-benz/vito", [/^(?:E VITO|EVITO|VITO)\b/]),
  rule("mercedes-benz", "mercedes-benz/v-class", [/^(?:V$|V CLASS|V KLASSE|V \d{3})\b/]),
  rule("mercedes-benz", "mercedes-benz/sprinter", [/^(?:E ?SPRINTER|SPRINTER)\b/]),
  rule("mercedes-benz", "mercedes-benz/citan", [/^(?:E ?CITAN|CITAN)\b/]),
  ...[
    ["a-class", "A"], ["b-class", "B"], ["c-class", "C"], ["e-class", "E"], ["s-class", "S"], ["g-class", "G"],
  ].map(([slug, letter]) => rule("mercedes-benz", `mercedes-benz/${slug}`, [new RegExp(`^(?:MERCEDES (?:BENZ )?)?(?:AMG )?${letter}(?: CLASS| KLASSE| ?\\d{2,3}[A-Z]*)\\b`)])),
  ...["CLA", "CLE", "CLS", "EQA", "EQB", "EQC", "EQE", "EQS", "GLA", "GLB", "GLC", "GLE", "GLS", "SL", "SLC"].map((name) =>
    rule("mercedes-benz", `mercedes-benz/${name.toLowerCase()}`, [new RegExp(`^${name}(?:$|\\s|\\d)`)])),
  rule("mercedes-benz", "mercedes-benz/amg-gt", [/^(?:MERCEDES )?AMG GT\b/]),

  ...["ct", "es", "gs", "gx", "hs", "is", "lbx", "lc", "lm", "ls", "lx", "nx", "rc", "rx", "rz", "ux"].map((name) =>
    rule("lexus", `lexus/${name}`, [new RegExp(`^(?:LEXUS )?${name.toUpperCase()}(?:$| ?\\d|\\s)`)])),

  rule("citroen", "citroen/c3-aircross", [/^(?:NUEVO )?(?:CITROEN )?(?:E )?C3 AIRCROSS\b/]),
  rule("citroen", "citroen/c3", [/^(?:NUEVO )?(?:CITROEN )?(?:E )?C3(?! AIR)\b/]),
  rule("citroen", "citroen/c4x", [/^(?:NUEVO )?(?:CITROEN )?(?:E )?C4 ?X\b/]),
  rule("citroen", "citroen/e-c4", [/^(?:NUEVO )?(?:CITROEN )?E C4\b/]),
  rule("citroen", "citroen/c4", [/^(?:NUEVO )?(?:CITROEN )?C4\b/]),
  rule("citroen", "citroen/c5-aircross", [/^(?:NUEVO )?(?:CITROEN )?C5 AIRCROSS\b/]),
  rule("citroen", "citroen/c5-x", [/^(?:NUEVO )?(?:CITROEN )?C5 X\b/]),
  rule("citroen", "citroen/c5", [/^(?:NUEVO )?(?:CITROEN )?C5(?! (?:AIRCROSS|X))\b/]),
  rule("citroen", "citroen/berlingo", [/^(?:NUEVO )?(?:CITROEN )?(?:E )?BERLINGO\b/]),
  rule("citroen", "citroen/jumpy", [/^(?:NUEVO )?(?:CITROEN )?(?:E )?JUMPY\b/]),
  rule("citroen", "citroen/jumper", [/^(?:NUEVO )?(?:CITROEN )?(?:E )?JUMPER\b/]),
  rule("citroen", "citroen/spacetourer", [/^(?:NUEVO )?(?:CITROEN )?(?:E )?SPACE ?TOURER\b/]),
  rule("citroen", "citroen/c-elysee", [/^(?:CITROEN )?C ELYS/]),
  rule("citroen", "citroen/c5-aircross", [/^SUV CITRO N C5 AIRCROSS\b/]),
  rule("citroen", "citroen/c5-x", [/^(?:NUEVO )?CITRO N C5 X\b/]),
  rule("citroen", "citroen/c4x", [/^AC4 X\b/]),
  rule("citroen", "citroen/c4", [/^AC4(?! X)\b/]),

  rule("peugeot", "peugeot/e-2008", [/^(?:NUEVO )?E 2008\b/]),
  rule("peugeot", "peugeot/e-208", [/^(?:NUEVO )?E 208\b/]),
  rule("peugeot", "peugeot/e-5008", [/^(?:NUEVO )?E 5008\b/]),
  ...["107", "108", "2008", "205", "206", "207", "208", "3008", "301", "307", "308", "4008", "406", "407", "408", "5008", "508", "807"].map((name) =>
    rule("peugeot", `peugeot/${name}`, [new RegExp(`^(?:NUEVO |N)?${name}\\b`), new RegExp(`^E ${name}\\b`)])),
  rule("peugeot", "peugeot/boxer", [/^(?:NUEVO )?(?:PEUGEOT )?(?:E )?BOXER\b/]),
  rule("peugeot", "peugeot/partner", [/^(?:NUEVO )?(?:PEUGEOT )?(?:E )?PARTNER\b/]),
  rule("peugeot", "peugeot/expert", [/^(?:NUEVO )?(?:PEUGEOT )?(?:E )?EXPERT\b/]),
  rule("peugeot", "peugeot/rifter", [/^(?:NUEVO )?(?:PEUGEOT )?(?:E )?RIFTER\b/]),
  rule("peugeot", "peugeot/traveller", [/^(?:NUEVO )?(?:PEUGEOT )?(?:E )?TRAVELLER\b/]),
  rule("peugeot", "peugeot/508", [/^N 508\b/]),
  rule("peugeot", "peugeot/3008", [/^(?:NUEVO )?E 3008\b/]),

  rule("hyundai", "hyundai/tucson", [/^(?:HYUNDAI)?TUCSONIX35\b/, /^TUCSON\b/]),
  rule("hyundai", "hyundai/kona", [/^(?:HYUNDAI)?KONAKAUAI\b/, /^KONA\b/]),
  rule("hyundai", "hyundai/i30", [/^I ?30N?\b/]),
  ...[10, 20, 40].map((number) => rule("hyundai", `hyundai/i${number}`, [new RegExp(`^I ?${number}\\b`)])),

  rule("seat", "cupra/ateca", [/^CUPRA ATECA\b/]),
  rule("seat", "cupra/born", [/^(?:CUPRA )?BORN\b/]),
  rule("seat", "cupra/formentor", [/^(?:CUPRA )?FORMENTOR\b/]),
  rule("seat", "cupra/leon", [/^CUPRA LEON\b/]),
  rule("seat", "cupra/tavascan", [/^CUPRA TAVASCAN\b/]),
  rule("seat", "cupra/tavascan", [/^TAVASCAN\b/]),
  rule("seat", "seat/tarraco", [/^TARACCO\b/]),
  rule("dr-automobiles", "evo/3", [/^(?:DR )?EVO ?3\b/]),
  rule("dr-automobiles", "evo/4", [/^(?:DR )?EVO ?4\b/]),
  rule("dr-automobiles", "evo/5", [/^(?:DR )?EVO ?5\b/]),
  rule("dr-automobiles", "evo/6", [/^(?:DR )?EVO ?6\b/]),
  rule("dr-automobiles", "evo/7", [/^(?:DR )?EVO ?7\b/]),

  rule("ds-automobiles", "ds-automobiles/ds-3", [/^(?:DS )?3(?: CROSSBACK)?\b/]),
  rule("ds-automobiles", "ds-automobiles/ds-4", [/^(?:DS )?4\b/]),
  rule("ds-automobiles", "ds-automobiles/ds-5", [/^(?:DS )?5\b/]),
  rule("ds-automobiles", "ds-automobiles/ds-7", [/^(?:DS )?7(?: CROSSBACK)?\b/]),
  rule("ds-automobiles", "ds-automobiles/ds-9", [/^(?:DS )?9\b/]),
  rule("ds-automobiles", "ds-automobiles/ds-n-4", [/^(?:DS )?N ?4\b/]),

  rule("land-rover", "land-rover/range-rover-evoque", [/^(?:LAND )?R ?ROVER EVOQUE\b/]),
  rule("land-rover", "land-rover/range-rover-sport", [/^(?:LAND )?R ?ROVER SPORT\b/]),
  rule("land-rover", "land-rover/range-rover-velar", [/^(?:LAND )?R ?ROVER VELAR\b/]),
  rule("land-rover", "land-rover/range-rover", [/^(?:LAND )?R ?ROVER(?! (?:EVOQUE|SPORT|VELAR))\b/]),
  rule("land-rover", "land-rover/discovery-sport", [/^(?:LAND ROVER )?DISCOVERY SPORT\b/]),
  rule("land-rover", "land-rover/discovery", [/^(?:LAND ROVER )?DISCOVERY\b/]),
  rule("land-rover", "land-rover/defender", [/^(?:LAND ROVER )?DEFENDER\b/]),
  rule("land-rover", "land-rover/discovery-sport", [/^DISCOVRY SPRT\b/]),
  rule("land-rover", "land-rover/range-rover-sport", [/^RR SPORT\b/]),

  rule("mazda", "mazda/mazda2", [/^(?:MAZDA )?2\b/]),
  rule("mazda", "mazda/mazda3", [/^(?:MAZDA )?3\b/]),
  rule("mazda", "mazda/mazda6", [/^(?:MAZDA )?6\b/]),
  ...[3, 5, 30, 50, 60, 7, 8, 80, 9].map((number) => rule("mazda", `mazda/cx-${number}`, [new RegExp(`^(?:MAZDA )?CX ?${number}\\b`)])),
  rule("mazda", "mazda/mx-30", [/^(?:MAZDA )?MX ?30\b/]),
  rule("mazda", "mazda/mx-5", [/^(?:MAZDA )?MX ?5\b/]),

  rule("renault", "renault/trafic", [/^TRAFF?IC\b/]),
  rule("renault", "renault/master", [/^MASTER\b/]),
  rule("renault", "renault/scenic", [/^(?:GRAND )?SCENIC\b/]),
  rule("renault", "renault/megane", [/^MEGANE\b/]),
  rule("renault", "renault/captur", [/^CAPTUR\b/]),
  rule("renault", "renault/clio", [/^CLIO\b/]),

  rule("opel", "opel/vivaro", [/^(?:OPEL )?(?:E )?VIVARO\b/]),
  rule("opel", "opel/combo", [/^(?:NUEVO )?(?:OPEL )?(?:E )?COMBO\b/]),
  rule("opel", "opel/astra", [/^NUEVO ASTRA\b/]),
  rule("opel", "opel/crossland", [/^CROSSLAND ?X?\b/]),
  rule("opel", "opel/grandland", [/^(?:NUEVO )?GRANDLAND ?X?\b/]),
  rule("opel", "opel/mokka", [/^MOKKA ?X?\b/]),
  rule("opel", "opel/zafira-life", [/^ZAFIRA LIFE\b/]),

  rule("volkswagen", "volkswagen/transporter", [/^(?:VW )?(?:TRANSPORTER|KOMBI)\b/]),
  rule("volkswagen", "volkswagen/crafter", [/^(?:VW )?CRAFTER\b/]),
  rule("volkswagen", "volkswagen/up", [/^(?:MOVE |E )?UP\b/]),
  ...[3, 4, 5, 6, 7].map((number) => rule("volkswagen", `volkswagen/id-${number}`, [new RegExp(`^ID ?${number}(?:$|[^0-9])`)])),
  rule("volkswagen", "volkswagen/id-buzz", [/^ID BUZZ\b/]),
  ...["golf", "polo", "passat", "tiguan", "touareg", "touran", "t-roc", "t-cross", "taigo", "taos", "tayron", "caddy", "caravelle", "multivan"].map((name) =>
    rule("volkswagen", `volkswagen/${name}`, [new RegExp(`^${name.toUpperCase().replace(/-/g, " ")}\\b`)])),

  rule("fiat", "fiat/ducato", [/^(?:FIAT )?(?:E )?DUCATO\b/]),
  rule("fiat", "fiat/talento", [/^(?:FIAT )?TALENTO\b/]),
  rule("fiat", "fiat/doblo", [/^(?:FIAT )?(?:E )?DOBLO\b/]),
  rule("fiat", "fiat/500", [/^(?:FIAT )?500\b/]),
  rule("fiat", "fiat/500", [/^500C\b/]),
  rule("fiat", "fiat/panda", [/^(?:FIAT )?PANDA\b/]),
  rule("fiat", "fiat/tipo", [/^(?:FIAT )?TIPO\b/]),
  rule("mini", "mini/countryman", [/^(?:MINI )?COUNTRYMAN\b/]),
  rule("mini", "mini/clubman", [/^(?:MINI )?CLUBMAN\b/]),
  rule("mini", "mini/paceman", [/^(?:MINI )?PACEMAN\b/]),
  rule("mini", "mini/cooper", [/^(?:MINI )?COOPER\b/]),
  rule("mini", "mini/one", [/^(?:MINI )?ONE\b/]),

  rule("polestar", "polestar/polestar-2", [/^(?:POLESTAR )?2\b/]),
  rule("polestar", "polestar/polestar-3", [/^(?:POLESTAR )?3\b/]),
  rule("polestar", "polestar/polestar-4", [/^(?:POLESTAR )?4\b/]),
  rule("polestar", "polestar/polestar-4", [/^PS4\b/]),
  rule("lynk-and-co", "lynk-and-co/01", [/^(?:LYNK(?: AND CO| CO)? )?01\b/]),
  rule("lynk-and-co", "lynk-and-co/02", [/^(?:LYNK(?: AND CO| CO)? )?02\b/]),
  rule("lynk-and-co", "lynk-and-co/08", [/^(?:LYNK(?: AND CO| CO)? )?08\b/]),
  rule("ssangyong", "ssangyong/korando", [/^(?:KG MOBILITY )?KORANDO\b/]),
  rule("ssangyong", "ssangyong/rexton", [/^(?:KG MOBILITY )?REXTON\b/]),
  rule("ssangyong", "ssangyong/actyon", [/^(?:KG MOBILITY )?ACTYON\b/]),
  rule("ssangyong", "ssangyong/tivoli", [/^(?:KG MOBILITY )?TIVOLI\b/]),
  rule("ssangyong", "ssangyong/torres", [/^(?:KG MOBILITY )?TORRES\b/]),

  rule("alfa-romeo", "alfa-romeo/stelvio", [/^(?:ALFA )?STELVIO\b/]),
  rule("alfa-romeo", "alfa-romeo/tonale", [/^(?:ALFA )?TONALE\b/]),
  rule("alfa-romeo", "alfa-romeo/giulia", [/^(?:ALFA )?GIULIA\b/]),
  rule("land-rover", "land-rover/range-rover-evoque", [/^EVOQUE\b/]),

  rule("nissan", "nissan/nv200", [/^(?:NISSAN )?E ?NV200\b/]),
  rule("kia", "kia/ceed", [/^CEEDSW(?:$|[ /])/]),
  rule("mg-motor", "mg-motor/mg3", [/^(?:MG )?(?:MG )?3\b/]),
  rule("mg-motor", "mg-motor/mg5", [/^(?:MG )?(?:MG )?5\b/]),
  rule("mg-motor", "mg-motor/marvel-r", [/^(?:MG )?(?:MG )?MARVEL(?: R)?\b/]),
  rule("mg-motor", "mg-motor/mgs5-ev", [/^(?:MG )?MGS5(?: ELECTRIC| EV)?\b/]),
  rule("dfsk", "dfsk/e5", [/^(?:DFSK )?(?:NAVOR )?E5\b/]),
  rule("hyundai", "hyundai/staria", [/^STARIA\b/]),
  rule("hyundai", "hyundai/h-1", [/^H 1(?:STAREX| GRAND STAREX)?\b/]),
  rule("hyundai", "hyundai/h-1", [/^H 1STAREX/]),
  rule("renault", "renault/5", [/^5 E TECH\b/]),
  rule("vauxhall", "vauxhall/grandland", [/^G LAND X\b/]),
  rule("vauxhall", "vauxhall/combo-life", [/^COMBO(?: E)? LIFE\b/]),
  rule("vauxhall", "vauxhall/vivaro-life", [/^VIVARO(?: E)? LIFE\b/]),

  rule("baic", "baic/x75", [/^X75\b/]),
  rule("dfsk", "dfsk/ix5", [/^IX5\b/]),
  rule("dr-automobiles", "dr-automobiles/f35", [/^(?:DR )?F35\b/]),
  rule("ds-automobiles", "ds-automobiles/ds-n-8", [/^(?:DS )?N 8\b/]),
  rule("ebro", "ebro/s800", [/^S800\b/]),
  rule("fiat", "fiat/scudo", [/^(?:FIAT )?SCUDO\b/]),
  rule("forthing", "forthing/forthing-4", [/^FORTHING 4\b/]),
  rule("forthing", "forthing/forthing-5", [/^FORTHING 5\b/]),
  rule("forthing", "forthing/t5-evo", [/^(?:FORTHING )?T5 EVO\b/]),
  rule("geely", "geely/coolray", [/^COOLRAY\b/]),
  rule("great-wall", "great-wall/haval-h2w", [/^HAVAL H2W\b/]),
  rule("great-wall", "great-wall/wey-coffee-01", [/^WEY COFFEE 01\b/]),
  rule("great-wall", "great-wall/wey-coffee-02", [/^WEY COFFEE 02\b/]),
  rule("mazda", "mazda/6e", [/^6E\b/]),
  rule("mg-motor", "mg-motor/rx6", [/^(?:MG )?(?:MG )?RX6\b/]),
  rule("nio", "nio/el7", [/^EL7\b/]),
  rule("nio", "nio/es8", [/^ES8\b/]),
  rule("nissan", "nissan/nv300", [/^(?:NISSAN )?NV300\b/]),
  rule("opel", "opel/movano", [/^(?:OPEL )?MOVANO\b/]),
  rule("seres", "seres/seres-3", [/^(?:SERES )?3\b/]),
  rule("seres", "seres/seres-5", [/^(?:SERES )?5\b/]),
  rule("swm", "swm/g01", [/^G01\b/]),
  rule("swm", "swm/g05", [/^G05\b/]),
  rule("xpeng", "xpeng/g3", [/^(?:XPENG )?G3\b/]),
  rule("alpina", "alpina/b5", [/^BMW ALPINA B5\b/]),
  rule("alpina", "alpina/d5-s", [/^BMW ALPINA D5 S\b/]),
  rule("alpina", "alpina/xb7", [/^BMW ALPINA XB7\b/]),
  rule("alpina", "alpina/xd3", [/^BMW ALPINA XD3\b/]),
  rule("alpina", "alpina/xd4", [/^BMW ALPINA XD4\b/]),
  rule("dr-automobiles", "dr-automobiles/eq1", [/^DR EQ1\b/]),
  rule("ebro", "ebro/s900", [/^S900\b/]),
  rule("ford", "ford/tourneo-connect", [/^(?:GR |GRAND )?TOURNEO CONNECT\b/]),
  rule("geely", "geely/cityray", [/^CITYRAY\b/]),
  rule("geely", "geely/starray", [/^STARRAY\b/]),
  rule("omoda", "omoda/e5", [/^E5\b/]),
  rule("polestar", "polestar/polestar-1", [/^(?:POLESTAR )?1\b/]),
  rule("mini", "mini/countryman", [/^C MAN\b/]),
  rule("hyundai", "hyundai/staria", [/^STARIA/]),
  rule("hyundai", "hyundai/tucson", [/^TUCSN\b/]),
  rule("hyundai", "hyundai/kona", [/^KONAN KAUAIN\b/]),
  rule("ds-automobiles", "ds-automobiles/ds-7", [/^NUEVO DS 7\b/]),
  rule("volkswagen", "volkswagen/up", [/^HIGH UP\b/]),
  rule("ford", "ford/mustang-mach-e", [/^MACH E\b/]),
  rule("audi", "audi/tt-rs", [/^TTRS\b/]),
  rule("lexus", "lexus/rx", [/^RXL\b/]),
  rule("jaguar", "jaguar/xj", [/^XJ50\b/]),
  rule("opel", "opel/insignia", [/^INSIGNIA(?:SPORTSTOURER)?\b/]),
  rule("volvo", "volvo/xc60", [/^[UX] XC60\b/]),
  rule("alfa-romeo", "alfa-romeo/giulia", [/^GIULLIA\b/]),
  rule("volvo", "volvo/xc40", [/^X XC40\b/]),
  rule("skoda", "skoda/citigo", [/^E CITIGO\b/]),
  rule("volkswagen", "volkswagen/atlas", [/^TERAMONT\b/]),
  rule("volkswagen", "volkswagen/caravelle", [/^ABT E CARAVELLE\b/]),
  rule("porsche", "porsche/911", [/^992 GT3\b/]),
  rule("alpina", "alpina/b3", [/^BMW ALPINA B3\b/]),
  rule("abarth", "abarth/595", [/^595C\b/]),
  rule("kia", "kia/soul-ev", [/^E SOUL\b/]),
  rule("bmw", "bmw/i4", [/^I440\b/]),
  rule("opel", "opel/zafira-life", [/^(?:NUEVO )?ZAFIRA\b/]),
  rule("dfsk", "dfsk/580", [/^(?:DFSK )?FENGON 580\b/]),
  rule("mini", "mini/jcw", [/^J COOPER WORKS\b/]),
  rule("dfsk", "dfsk/fengon-5", [/^FENGON 5\b/]),
  rule("dr-automobiles", "dr-automobiles/7h", [/^DR 7H\b/]),
  rule("dr-automobiles", "dr-automobiles/art-e3", [/^DR ART E3\b/]),
  rule("forthing", "forthing/friday", [/^FRIDAY\b/]),
  rule("geely", "geely/atlas-pro", [/^ATLAS PRO\b/]),
  rule("great-wall", "great-wall/wey-05", [/^WEY 05\b/]),
  rule("faw", "hongqi/e-hs9", [/^HONGQI E HS9\b/]),
  rule("jac", "jac/e30x", [/^E30X\b/]),
  rule("jac", "jac/e-js4", [/^E JS4\b/]),
  rule("jac", "jac/es4", [/^ES4\b/]),
  rule("jac", "jac/iev7s", [/^IEV7S\b/]),
  rule("sportequipe", "sportequipe/ich-x-k3", [/^ICH X K3\b/]),
  rule("sportequipe", "sportequipe/x-k2", [/^X K2\b/]),
  rule("borgward", "borgward/bx7", [/^BX7\b/]),
  rule("hyundai", "hyundai/santa-fe", [/^SANTA$/]),
  rule("bmw", "bmw/i7", [/^I750 XDRIVE$/]),
];

const REJECT_RULES = [
  reject("bmw", "generic BMW series label without one model family", [/^SERIE X$/, /^SERIE I$/]),
  reject("citroen", "generic or truncated commercial text without one model family", [/^NUEVO$/, /^SUV$/, /^GRAND$/]),
  reject("citroen", "combined Jumpy and Spacetourer identity", [/^JUMPY SPACE ?TOURER\b/]),
  reject("peugeot", "generic Spanish new-model marker without one model", [/^NUEVO$/]),
  reject("mini", "brand-only commercial name", [/^MINI$/]),
  reject("opel", "combined Vivaro and Zafira Life identity", [/^VIVARO ZAFIRA LIFE$/]),
  reject("seat", "brand-only Cupra identity under SEAT source make", [/^CUPRA$/]),
  reject("tesla", "generic model placeholder", [/^MODEL$/]),
  reject("audi", "generic RS derivative label", [/^RS$/]),
  reject("fiat", "brand-only Abarth identity under Fiat source make", [/^ABARTH$/]),
  reject("volkswagen", "combined Transporter and Caravelle identity", [/^TRANSPORTER CARAVELLE$/]),
  reject("smart", "generic EQ badge without one Smart model family", [/^EQ$/]),
  reject("toyota", "truncated or generic model text", [/^(?:LAND|NA|GR)$/]),
  reject("mitsubishi", "truncated Space family without one model boundary", [/^SPACE$/]),
  reject("lynk-and-co", "truncated brand-only commercial name", [/^LYNK$/]),
  reject("dr-automobiles", "generic EVO sub-brand without one numbered model", [/^DR EVO$/]),
  reject("infiniti", "cross-brand Nissan X-Trail contamination under Infiniti", [/^NISSAN X TRAIL$/]),
  reject("fiat", "mixed Fiat 500 and Abarth identity", [/^F1AT 500 500 ABARTH$/]),
  reject("hyundai", "cross-brand Genesis identity under Hyundai", [/^GV70 GENESIS GV70$/]),
  reject("peugeot", "cross-brand Opel model contamination", [/^(?:VIVARO ZAFIRA LIFE|CORSA SE)$/]),
  reject("abarth", "brand-only commercial name", [/^ABARTH$/]),
  reject("mini", "truncated John Cooper Works badge without one model family", [/^JOHN$/]),
  reject("bmw", "generic or cross-brand commercial text", [/^(?:SERIE Z|SERIJA X|COUNTRYMAN COOPER S|I20 DYN AWD)$/]),
  reject("opel", "missing model identity", [/^NA$/]),
  reject("mercedes-benz", "generic class letter or future van architecture without one model", [/^(?:M|VAN EA)$/]),
  reject("citroen", "cross-brand Opel model contamination", [/^CORSA SE(?: PREMIUM)?$/]),
  reject("peugeot", "cross-brand Opel model contamination", [/^CORSA SE(?: PREMIUM)?$/]),
  reject("hyundai", "cross-brand Genesis identity under Hyundai", [/^GV(?:60|80) GENESIS GV(?:60|80)$/]),
  reject("leapmotor", "placeholder without a model identity", [/^$/]),
  reject("jeep", "combined historical and current model labels", [/^JUNIOR AVENGER$/]),
  reject("mercedes-benz", "cross-brand Smart model contamination", [/^EQ FORTWO COUPE$/]),
  reject("fiat", "cross-brand Jeep model contamination", [/^COMPASS$/]),
  reject("hyundai", "cross-brand Genesis identity under Hyundai", [/^G70 GENESIS G70$/]),
];

function datasetIdsForYears(years) {
  const ids = new Set();
  for (const year of years || []) {
    if (year <= 2022) ids.add("src-eea-co2cars-2020-2022-final");
    else if (year === 2023) ids.add("src-eea-co2cars-2023-final");
    else if (year === 2024) ids.add("src-eea-co2cars-2024-provisional");
    else if (year === 2025) ids.add("src-eea-co2cars-2025-provisional");
  }
  return [...ids].sort();
}

async function loadUnmatched(report) {
  const rows = [];
  for (const file of report.collections.unmatchedCommercialNames || []) {
    const value = await readJson(path.join(WORKSPACE_ROOT, report.reportDirectory, file));
    rows.push(...value.records);
  }
  return rows;
}

function addSourceName(model, row) {
  const sourceIds = datasetIdsForYears(row.years);
  const existing = (model.sourceNames || []).find((sourceName) => normalizeTerm(sourceName.value) === normalizeTerm(row.commercialName));
  if (existing) {
    existing.sourceIds = [...new Set([...(existing.sourceIds || []), ...sourceIds])].sort();
    return;
  }
  model.sourceNames = [...(model.sourceNames || []), {
    value: row.commercialName,
    kind: "source_spelling",
    safe: false,
    language: "en",
    market: "Europe",
    sourceIds,
  }].sort((left, right) => left.value.localeCompare(right.value, "en"));
}

function chunk(entityType, records) {
  return Array.from({ length: Math.ceil(records.length / 250) }, (_, index) => ({
    schemaVersion: 2,
    entityType,
    chunk: index + 1,
    maxRecords: 250,
    records: records.slice(index * 250, (index + 1) * 250),
  }));
}

export async function buildEeaReviewedModelAliasBatch01({ verifiedAt = "2026-08-17" } = {}) {
  const [workspace, eea] = await Promise.all([loadWorkspace(), readJson(EEA_REPORT)]);
  const rows = await loadUnmatched(eea);
  const models = new Map(workspace.records.model.map((model) => [model.id, structuredClone(model)]));
  for (const mapping of MAP_RULES) {
    if (!models.has(mapping.modelId)) throw new Error(`Missing EEA alias target: ${mapping.modelId}`);
  }

  const accepted = [];
  const rejected = [];
  const ambiguous = [];
  const unresolved = [];
  const updated = new Set();
  for (const row of rows) {
    const term = folded(row.commercialName);
    const rejection = REJECT_RULES.find((candidate) => candidate.sourceBrandId === row.brandId && candidate.patterns.some((pattern) => pattern.test(term)));
    if (rejection) {
      rejected.push({ ...row, normalized: term, reason: rejection.reason });
      continue;
    }
    const matches = MAP_RULES.filter((candidate) => candidate.sourceBrandId === row.brandId && candidate.patterns.some((pattern) => pattern.test(term)));
    const targets = [...new Set(matches.map((match) => match.modelId))];
    if (targets.length > 1) {
      ambiguous.push({ ...row, normalized: term, candidateModelIds: targets.sort() });
      continue;
    }
    if (!targets.length) {
      unresolved.push(row);
      continue;
    }
    const model = models.get(targets[0]);
    addSourceName(model, row);
    if (!(model.researchNotes || []).includes("Reviewed EEA commercial-name spellings are retained as unsafe source aliases for English canonical model resolution.")) {
      model.researchNotes = [...(model.researchNotes || []), "Reviewed EEA commercial-name spellings are retained as unsafe source aliases for English canonical model resolution."];
    }
    model.updatedAt = verifiedAt;
    updated.add(model.id);
    accepted.push({ ...row, normalized: term, targetModelId: model.id, targetCanonicalName: model.canonicalName });
  }

  const sumRegistrations = (values) => values.reduce((sum, row) => sum + row.registrations, 0);
  const updatedModels = [...updated].map((id) => models.get(id)).sort((left, right) => left.id.localeCompare(right.id, "en"));
  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    policy: {
      exactSourceSpellingPreserved: true,
      reviewedBrandSpecificRuleRequired: true,
      trimRichAliasesUnsafeForAutomaticResolution: true,
      crossBrandMappingsExplicit: true,
      genericAndMixedRowsRejected: true,
      automaticPublicationReady: false,
    },
    totals: {
      sourceRows: rows.length,
      accepted: accepted.length,
      rejected: rejected.length,
      ambiguous: ambiguous.length,
      unresolved: unresolved.length,
      updatedModels: updatedModels.length,
      sourceRegistrations: sumRegistrations(rows),
      acceptedRegistrations: sumRegistrations(accepted),
      rejectedRegistrations: sumRegistrations(rejected),
      ambiguousRegistrations: sumRegistrations(ambiguous),
      unresolvedRegistrations: sumRegistrations(unresolved),
      decidedRegistrationPercent: Number((((sumRegistrations(accepted) + sumRegistrations(rejected)) / sumRegistrations(rows)) * 100).toFixed(2)),
    },
    byTarget: [...new Set(accepted.map((row) => row.targetModelId))].map((modelId) => ({
      modelId,
      canonicalName: models.get(modelId).canonicalName,
      sourceNames: accepted.filter((row) => row.targetModelId === modelId).length,
      registrations: sumRegistrations(accepted.filter((row) => row.targetModelId === modelId)),
    })).sort((left, right) => right.registrations - left.registrations || left.modelId.localeCompare(right.modelId, "en")),
    accepted,
    rejected,
    ambiguous,
    unresolved,
  };
  return { report, ingestion: { schemaVersion: 2, batches: chunk("model", updatedModels) } };
}

async function main() {
  const { report, ingestion } = await buildEeaReviewedModelAliasBatch01();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
