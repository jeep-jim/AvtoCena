import assert from "node:assert/strict";
import test from "node:test";
import { myAutoProductSnapshotFromInfo } from "../apps/web/lib/catalog/myauto-list-source";

test("MyAuto exact product metadata can build a full listing-bound gallery even when the list card has no image", () => {
  const snapshot = myAutoProductSnapshotFromInfo({
    car_id: 123016475,
    photo: "7/4/6/1/0",
    pic_number: 15,
    photo_ver: 0,
    engine_volume: 1500,
    cylinders: 4,
  }, "123016475");
  assert.ok(snapshot);
  assert.equal(snapshot?.galleryUrls.length, 15);
  assert.equal(snapshot?.galleryUrls[0], "https://static.tnet.ge/myauto/photos/7/4/6/1/0/large/123016475_1.jpg?v=0");
  assert.equal(snapshot?.galleryUrls[14], "https://static.tnet.ge/myauto/photos/7/4/6/1/0/large/123016475_15.jpg?v=0");
  assert.equal(snapshot?.engineCc, 1500);
  assert.equal(snapshot?.semanticEvidence.engineCc.status, "exact");
});

test("MyAuto exact product metadata never crosses listing identity", () => {
  const info = { car_id: 123016475, photo: "7/4/6/1/0", pic_number: 15, photo_ver: 0 };
  assert.equal(myAutoProductSnapshotFromInfo(info, "123016476"), null);
  assert.equal(myAutoProductSnapshotFromInfo(info, "123016475", "9/9/9/9/9"), null);
});

test("MyAuto product snapshot accepts only explicit horsepower fields and bounded engine displacement", () => {
  const snapshot = myAutoProductSnapshotFromInfo({
    car_id: 123016475,
    photo: "7/4/6/1/0",
    pic_number: 2,
    photo_ver: 0,
    engine_volume: 1500,
    power: 85,
    power_hp: 116,
  }, "123016475");
  assert.equal(snapshot?.engineCc, 1500);
  assert.equal(snapshot?.powerHp, 116);

  const unsafe = myAutoProductSnapshotFromInfo({
    car_id: 123016475,
    photo: "7/4/6/1/0",
    pic_number: 2,
    photo_ver: 0,
    engine_volume: 99_999,
    horsepower: 9_999,
  }, "123016475");
  assert.equal(unsafe?.engineCc, undefined);
  assert.equal(unsafe?.powerHp, undefined);
  assert.equal(unsafe?.semanticEvidence.engineCc.status, "ambiguous");
  assert.equal(unsafe?.semanticEvidence.powerHp.status, "ambiguous");
});

test("MyAuto product snapshot refuses conflicting structured metrics", () => {
  const snapshot = myAutoProductSnapshotFromInfo({
    car_id: 123016475,
    photo: "7/4/6/1/0",
    pic_number: 2,
    photo_ver: 0,
    engine_volume: 1500,
    engine_cc: 2000,
    power_hp: 116,
    horsepower: 150,
  }, "123016475");
  assert.ok(snapshot);
  assert.equal(snapshot.engineCc, undefined);
  assert.equal(snapshot.powerHp, undefined);
  assert.equal(snapshot.semanticEvidence.engineCc.status, "conflict");
  assert.equal(snapshot.semanticEvidence.powerHp.status, "conflict");
});
