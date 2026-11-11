"use client";

import { useLayoutEffect } from "react";

type TileInfo = {
  tile: HTMLElement;
  wide: boolean;
  index: number;
};

function setHalfWidth(tile: HTMLElement) {
  const basis = "calc(50% - 5px)";
  tile.style.setProperty("flex", `0 0 ${basis}`, "important");
  tile.style.setProperty("width", basis, "important");
  tile.style.setProperty("max-width", basis, "important");
  tile.style.setProperty("grid-column", "auto", "important");
}

function setFullWidth(tile: HTMLElement) {
  tile.style.setProperty("flex", "0 0 100%", "important");
  tile.style.setProperty("width", "100%", "important");
  tile.style.setProperty("max-width", "100%", "important");
  tile.style.setProperty("grid-column", "1 / -1", "important");
}

function tileNeedsWideRow(tile: HTMLElement) {
  const value = tile.querySelector<HTMLElement>(":scope > span");
  if (!value) return false;

  value.style.setProperty("white-space", "nowrap", "important");
  value.style.setProperty("word-break", "normal", "important");
  value.style.setProperty("overflow-wrap", "normal", "important");

  // Measure the chip exactly at the normal half-row width. If the actual content
  // cannot stay on one line, that chip gets a full row instead of wrapping.
  return tile.scrollWidth > tile.clientWidth + 2;
}

function smartVisualOrder(items: TileInfo[]) {
  const consumed = new Set<number>();
  const result: TileInfo[] = [];

  for (let i = 0; i < items.length; i += 1) {
    if (consumed.has(i)) continue;
    const current = items[i];

    if (current.wide) {
      result.push(current);
      consumed.add(i);
      continue;
    }

    let partnerIndex = -1;
    for (let j = i + 1; j < items.length; j += 1) {
      if (consumed.has(j) || items[j].wide) continue;
      partnerIndex = j;
      break;
    }

    result.push(current);
    consumed.add(i);

    if (partnerIndex >= 0) {
      result.push(items[partnerIndex]);
      consumed.add(partnerIndex);
    }
  }

  return result;
}

function lockOfferSpecPairs() {
  const grid = document.querySelector<HTMLElement>(".ac-offer-page .ac-offer-spec-grid");
  if (!grid) return;

  grid.style.setProperty("display", "flex", "important");
  grid.style.setProperty("flex-wrap", "wrap", "important");
  grid.style.setProperty("gap", "10px", "important");
  grid.style.setProperty("grid-template-columns", "none", "important");
  grid.style.setProperty("grid-auto-flow", "row", "important");

  const tiles = Array.from(grid.children).filter((node): node is HTMLElement =>
    node instanceof HTMLElement && node.classList.contains("ac-offer-spec-tile"),
  );

  // Reset to the normal two-column geometry first so the width test is real and
  // independent from whatever layout the previous pass left behind.
  tiles.forEach((tile, index) => {
    tile.style.setProperty("order", String(index), "important");
    setHalfWidth(tile);
  });

  const measured: TileInfo[] = tiles.map((tile, index) => ({
    tile,
    index,
    wide: tileNeedsWideRow(tile),
  }));

  const ordered = smartVisualOrder(measured);

  ordered.forEach((item, visualIndex) => {
    item.tile.style.setProperty("order", String(visualIndex), "important");
    if (item.wide) setFullWidth(item.tile);
    else setHalfWidth(item.tile);
  });

  // A lone short chip at the very end should never leave a half-row hole.
  const narrow = ordered.filter((item) => !item.wide);
  if (narrow.length % 2 === 1) {
    const lastNarrow = [...ordered].reverse().find((item) => !item.wide);
    if (lastNarrow) setFullWidth(lastNarrow.tile);
  }
}

export function OfferSpecGridStabilizer() {
  useLayoutEffect(() => {
    lockOfferSpecPairs();

    const frame = requestAnimationFrame(lockOfferSpecPairs);
    const timers = [0, 80, 250, 700, 1500].map((delay) => window.setTimeout(lockOfferSpecPairs, delay));
    window.addEventListener("resize", lockOfferSpecPairs);

    return () => {
      cancelAnimationFrame(frame);
      timers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("resize", lockOfferSpecPairs);
    };
  }, []);

  return null;
}
