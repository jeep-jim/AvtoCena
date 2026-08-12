"use client";

import { useEffect } from "react";

function setImportant(element: HTMLElement, property: string, value: string) {
  element.style.setProperty(property, value, "important");
}

function clearAdaptiveStyle(element: HTMLElement) {
  for (const property of ["position", "left", "right", "top", "bottom", "width", "max-height", "overflow-y", "z-index", "margin"]) {
    element.style.removeProperty(property);
  }
  delete element.dataset.acAdaptive;
  delete element.dataset.acDropDirection;
}

function compactRangeCopy() {
  document.querySelectorAll<HTMLInputElement>(".ac-catalog-filter-panel .ac-range-input-box input, .ac-mobile-filter-sheet .ac-range-input-box input").forEach((input) => {
    const aria = input.getAttribute("aria-label") || "";
    if (/\:\s*от$/i.test(aria)) input.placeholder = "от";
    if (/\:\s*до$/i.test(aria)) input.placeholder = "до";
  });

  document.querySelectorAll<HTMLElement>(".ac-mobile-filter-sheet .ac-range-card > div:first-child > div:first-child > div:first-child").forEach((title) => {
    if ((title.textContent || "").trim() === "Объём двигателя") title.textContent = "Объём";
  });
}

function positionMobileDropdown(dropdown: HTMLElement) {
  const sheet = dropdown.closest<HTMLElement>(".ac-mobile-filter-sheet");
  if (!sheet || window.innerWidth >= 1024) {
    if (dropdown.dataset.acAdaptive === "1") clearAdaptiveStyle(dropdown);
    return;
  }

  const anchor = dropdown.parentElement as HTMLElement | null;
  if (!anchor) return;

  const scrollHost = anchor.closest<HTMLElement>(".ac-mobile-filter-sheet > .ac-hide-scrollbar");
  const anchorRect = anchor.getBoundingClientRect();
  const boundaryRect = (scrollHost || sheet).getBoundingClientRect();
  const viewportTop = Math.max(8, boundaryRect.top + 6);
  const viewportBottom = Math.min(window.innerHeight - 8, boundaryRect.bottom - 6);
  const gap = 7;
  const below = Math.max(0, viewportBottom - anchorRect.bottom - gap);
  const above = Math.max(0, anchorRect.top - viewportTop - gap);
  const preferredHeight = Math.min(340, Math.max(220, Math.round(window.innerHeight * 0.42)));
  const openUp = below < Math.min(210, preferredHeight) && above > below;
  const available = openUp ? above : below;
  const maxHeight = Math.max(132, Math.min(preferredHeight, available || preferredHeight));
  const viewportGutter = 12;
  const minWidth = 240;
  const width = Math.min(Math.max(anchorRect.width, minWidth), window.innerWidth - viewportGutter * 2);
  let left = anchorRect.left;
  if (left + width > window.innerWidth - viewportGutter) left = window.innerWidth - viewportGutter - width;
  left = Math.max(viewportGutter, left);

  dropdown.dataset.acAdaptive = "1";
  dropdown.dataset.acDropDirection = openUp ? "up" : "down";
  setImportant(dropdown, "position", "fixed");
  setImportant(dropdown, "left", `${Math.round(left)}px`);
  setImportant(dropdown, "right", "auto");
  setImportant(dropdown, "width", `${Math.round(width)}px`);
  setImportant(dropdown, "max-height", `${Math.round(maxHeight)}px`);
  setImportant(dropdown, "overflow-y", "auto");
  setImportant(dropdown, "z-index", "10090");
  setImportant(dropdown, "margin", "0");

  if (openUp) {
    setImportant(dropdown, "top", "auto");
    setImportant(dropdown, "bottom", `${Math.max(8, Math.round(window.innerHeight - anchorRect.top + gap))}px`);
  } else {
    setImportant(dropdown, "bottom", "auto");
    setImportant(dropdown, "top", `${Math.min(window.innerHeight - 8, Math.round(anchorRect.bottom + gap))}px`);
  }

  const list = Array.from(dropdown.children).find((child) => child.classList.contains("ac-hide-scrollbar")) as HTMLElement | undefined;
  if (list) {
    const hasSearch = Boolean(dropdown.querySelector(":scope > div:not(.ac-hide-scrollbar) input"));
    setImportant(list, "max-height", `${Math.max(100, Math.round(maxHeight - (hasSearch ? 58 : 16)))}px`);
    setImportant(list, "overflow-y", "auto");
  }
}

export function CatalogFilterUiEnhancer() {
  useEffect(() => {
    let frame = 0;
    const refresh = () => {
      frame = 0;
      compactRangeCopy();
      document.querySelectorAll<HTMLElement>(".ac-mobile-filter-sheet .ac-filter-dropdown").forEach(positionMobileDropdown);
    };
    const requestRefresh = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(refresh);
    };

    refresh();
    const observer = new MutationObserver(requestRefresh);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", requestRefresh);
    window.addEventListener("scroll", requestRefresh, true);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", requestRefresh);
      window.removeEventListener("scroll", requestRefresh, true);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
