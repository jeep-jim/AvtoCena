"use client";

import { useLayoutEffect } from "react";

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

  tiles.forEach((tile, index) => {
    const fullWidth = tiles.length % 2 === 1 && index === tiles.length - 1;
    const basis = fullWidth ? "100%" : "calc(50% - 5px)";
    tile.style.setProperty("flex", `0 0 ${basis}`, "important");
    tile.style.setProperty("width", basis, "important");
    tile.style.setProperty("max-width", basis, "important");
    tile.style.setProperty("grid-column", "auto", "important");
  });
}

export function OfferSpecGridStabilizer() {
  useLayoutEffect(() => {
    lockOfferSpecPairs();

    const frame = requestAnimationFrame(lockOfferSpecPairs);
    const timers = [0, 80, 250, 700, 1500, 3000].map((delay) => window.setTimeout(lockOfferSpecPairs, delay));
    window.addEventListener("resize", lockOfferSpecPairs);

    return () => {
      cancelAnimationFrame(frame);
      timers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("resize", lockOfferSpecPairs);
    };
  }, []);

  return null;
}
