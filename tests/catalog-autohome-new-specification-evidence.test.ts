import assert from "node:assert/strict";
import test from "node:test";
import {
  AutohomeNewExactAdapter,
  autohomeNewSpecificationEvidence,
} from "../apps/web/lib/catalog/autohome-new-exact-source";
import { classifySpecificationEvidence } from "../apps/web/lib/catalog/specification-evidence-audit";

const source = new AutohomeNewExactAdapter();

function configValue(specId: string, value: string) {
  return [{ specid: Number(specId), value }];
}

function configMarkup(specId: string, energy: string, engine: string, hp: string, kw: string) {
  const config = {
    result: {
      paramtypeitems: [
        {
          name: "基本参数",
          paramitems: [
            { id: 1149, name: "能源类型", valueitems: configValue(specId, energy) },
            { id: 1265, name: "变速箱", valueitems: configValue(specId, "6挡手动") },
            { id: 1147, name: "车身结构", valueitems: configValue(specId, "4门5座三厢车") },
          ],
        },
        {
          name: "发动机",
          paramitems: [
            { id: 1150, name: "发动机", valueitems: configValue(specId, engine) },
            { id: 1294, name: "最大马力(Ps)", valueitems: configValue(specId, hp) },
            { id: 1185, name: "最大功率(kW)", valueitems: configValue(specId, kw) },
          ],
        },
      ],
    },
  };
  return `<script>var config = ${JSON.stringify(config)};</script>`;
}

function galleryMarkup(specId: string) {
  const list = Array.from({ length: 5 }, (_, index) => ({
    specid: Number(specId),
    picpath: `https://car3.autoimg.cn/cardfs/product/autohome-${specId}-${index}.jpg`,
  }));
  return `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { SeriesPicList: { picinfo: { callist: [{ list }] } } } },
  })}</script>`;
}

test("Autohome promotes only a consistent combustion specification", async () => {
  const specId = "76140";
  const offer = source.normalizeOffer({
    specId,
    seriesId: "8148",
    trimTitle: "2025款 1.5T 手动版",
    year: 2025,
    priceWan: 12.5,
    sourcePriceCny: 125_000,
    sourceUrl: `https://www.autohome.com.cn/spec/${specId}/`,
  });
  assert.ok(offer);

  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/config/spec/")) return new Response(configMarkup(specId, "汽油", "1.5T 107马力 L4", "107", "78.5"), { status: 200 });
    if (url.includes("/cars/imglist-")) return new Response(galleryMarkup(specId), { status: 200 });
    return new Response("<title>【图】测试车型 2025款 1.5T 手动版报价_图片_测试品牌_汽车之家</title>", { status: 200 });
  };
  try {
    const images = await source.fetchImages(offer);
    assert.equal(images.length, 5);
    assert.equal(offer.fuel, "petrol");
    assert.equal(offer.powertrainKind, "combustion");
    assert.equal(offer.engineCc, 1500);
    assert.equal(offer.powerHp, 107);
    assert.equal(offer.powerKw, 78.5);
    assert.equal(offer.powerDataConfidence, "source_exact");
    assert.equal(classifySpecificationEvidence(offer, "fuelPowertrain").state, "exact");
    assert.equal(classifySpecificationEvidence(offer, "engineCc").state, "exact");
    assert.equal(classifySpecificationEvidence(offer, "powerHp").state, "exact");
  } finally {
    global.fetch = originalFetch;
  }
});

test("Autohome rejects ranges, unknown energy and inconsistent hp/kW", () => {
  const range = autohomeNewSpecificationEvidence({
    listingYear: 2025,
    detailYear: 2025,
    energy: "汽油",
    engine: "1.5T-2.0T",
    engineMaxHp: "100-150",
    engineMaxKw: "78.5-110",
  });
  assert.equal(range.engineCc.status, "ambiguous");
  assert.equal(range.powerHp.status, "ambiguous");
  assert.equal(range.powerKw.status, "ambiguous");

  const conflict = autohomeNewSpecificationEvidence({ energy: "汽油", engineMaxHp: "107", engineMaxKw: "110" });
  assert.equal(conflict.powerHp.status, "conflict");
  assert.equal(conflict.powerKw.status, "conflict");
  assert.equal(conflict.powerHp.value, undefined);

  const unknown = autohomeNewSpecificationEvidence({ energy: "其他", engine: "1.5T", engineMaxHp: "107" });
  assert.equal(unknown.fuel.status, "ambiguous");
  assert.equal(unknown.powertrainKind.status, "ambiguous");
  assert.equal(unknown.powerHp.status, "ambiguous");
});

test("Autohome classifies light and range-extender hybrids without promoting peak maxima", () => {
  const lightHybrid = autohomeNewSpecificationEvidence({
    energy: "汽油+48V轻混系统",
    engine: "2.0T",
    engineMaxHp: "252",
    engineMaxKw: "185",
  });
  assert.equal(lightHybrid.fuel.value, "hybrid");
  assert.equal(lightHybrid.powertrainKind.value, "other_hybrid");
  assert.equal(lightHybrid.engineCc.value, 2000);
  assert.equal(lightHybrid.powerHp.status, "missing");
  assert.equal(lightHybrid.powerKw.status, "missing");

  const rangeExtender = autohomeNewSpecificationEvidence({ energy: "增程式", engineMaxHp: "150", engineMaxKw: "110" });
  assert.equal(rangeExtender.fuel.value, "hybrid");
  assert.equal(rangeExtender.powertrainKind.value, "series_hybrid");
  assert.equal(rangeExtender.powerHp.value, undefined);
});

test("Autohome marks year disagreement and EV displacement as conflicts", () => {
  const year = autohomeNewSpecificationEvidence({ listingYear: 2025, detailYear: 2024 });
  assert.equal(year.year.status, "conflict");
  const ev = autohomeNewSpecificationEvidence({ energy: "纯电动", engine: "1.5T" });
  assert.equal(ev.fuel.value, "electric");
  assert.equal(ev.powertrainKind.value, "electric");
  assert.equal(ev.engineCc.status, "conflict");
  assert.equal(ev.engineCc.value, undefined);
});

test("Autohome derives the missing combustion unit only from one exact named unit", () => {
  const fromHp = autohomeNewSpecificationEvidence({ energy: "汽油", engineMaxHp: "107" });
  assert.equal(fromHp.powerHp.value, 107);
  assert.equal(fromHp.powerKw.value, 78.7);
  assert.equal(fromHp.powerKw.status, "exact");
  const fromKw = autohomeNewSpecificationEvidence({ energy: "柴油", engineMaxKw: "110" });
  assert.equal(fromKw.powerKw.value, 110);
  assert.equal(fromKw.powerHp.value, 149.6);
  assert.equal(fromKw.powerHp.status, "exact");
});
