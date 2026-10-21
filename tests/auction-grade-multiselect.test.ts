import assert from "node:assert/strict";
import test from "node:test";
import { auctionGradeSelections, matchesAuctionGrades } from "../apps/web/lib/catalog/auction-grade-filter";
import { catalogSearchProjectionMatches, type CatalogSearchProjection } from "../apps/web/lib/catalog/storage";

test("grade selections keep old single values, decimal commas and special grades", () => {
  assert.deepEqual(auctionGradeSelections("4,5"), ["4.5"]);
  assert.deepEqual(auctionGradeSelections("4|4.5|4|ra|***"), ["4", "4.5", "RA", "***"]);
  assert.equal(matchesAuctionGrades("3.5", "4|4.5"), false);
  assert.equal(matchesAuctionGrades(undefined, "4|4.5"), false);
  assert.equal(matchesAuctionGrades("4", "invalid"), false);
  assert.equal(matchesAuctionGrades(undefined, ""), true);
});

test("catalog projection matches any selected grade while retaining the other filters", () => {
  const row = {market:"japan",make:"Toyota",model:"Aqua",year:2021,auctionGrade:"4.5"} as CatalogSearchProjection;
  assert.equal(catalogSearchProjectionMatches(row, {market:"japan",auctionGrade:"4|4.5"}), true);
  assert.equal(catalogSearchProjectionMatches({...row,auctionGrade:"4"}, {auctionGrade:"4|4.5"}), true);
  assert.equal(catalogSearchProjectionMatches({...row,auctionGrade:"3.5"}, {auctionGrade:"4|4.5"}), false);
  assert.equal(catalogSearchProjectionMatches(row, {auctionGrade:"4|4.5",yearFrom:2022}), false);
  const query = new URLSearchParams({auctionGrade:"4|4.5|RA"});
  assert.deepEqual(auctionGradeSelections(new URLSearchParams(query.toString()).get("auctionGrade")), ["4","4.5","RA"]);
});
