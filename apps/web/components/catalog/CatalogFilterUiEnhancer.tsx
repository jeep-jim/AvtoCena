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
    const plain = (title.textContent || "").trim();
    if (plain === "Объём двигателя") title.textContent = "Объём";
  });
}

function rangeIconMarkup(title: string) {
  if (/^год$/i.test(title)) {
    return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 2v3M17 2v3M4 8h16M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  }
  if (/^цена$/i.test(title)) {
    return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8"/><path d="M9 7.8h4.1a3 3 0 1 1 0 6H9m0-3.1h6M10.2 13.8V18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  if (/^пробег$/i.test(title)) {
    return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 17a7 7 0 1 1 14 0" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M12 17l3.4-4.1M6.5 17h11" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 8h12l2 3v6H5V8Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M2 11h3M19 12h3M8 5v3M15 5v3M8 17v2M16 17v2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
}

function decorateRangeControls() {
  document.querySelectorAll<HTMLElement>(".ac-catalog-filter-panel .ac-range-card, .ac-mobile-filter-sheet .ac-range-card").forEach((card) => {
    const title = card.querySelector<HTMLElement>(":scope > div:first-child > div:first-child > div:first-child");
    if (!title) return;
    const plainTitle = (title.dataset.acRangeTitle || title.textContent || "").trim();
    if (!plainTitle) return;
    title.dataset.acRangeTitle = plainTitle;
    title.classList.add("ac-range-title-with-icon");
    if (!title.querySelector(":scope > .ac-range-title-icon")) {
      const icon = document.createElement("span");
      icon.className = "ac-range-title-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = rangeIconMarkup(plainTitle);
      title.prepend(icon);
    }

    const presetRow = card.querySelector<HTMLElement>(":scope > div:nth-child(3)");
    const presetButtons = presetRow ? Array.from(presetRow.querySelectorAll<HTMLButtonElement>("button.ac-range-preset")) : [];
    if (!presetButtons.length || card.querySelector(":scope > .ac-range-preset-select-wrap")) return;

    const wrap = document.createElement("label");
    wrap.className = "ac-range-preset-select-wrap";
    wrap.setAttribute("aria-label", `Быстрые значения: ${plainTitle}`);
    const select = document.createElement("select");
    select.className = "ac-range-preset-select";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Быстро";
    select.appendChild(placeholder);
    presetButtons.forEach((button, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = (button.textContent || "").trim();
      select.appendChild(option);
    });
    select.addEventListener("change", () => {
      const index = Number(select.value);
      if (Number.isInteger(index) && index >= 0 && presetButtons[index]) presetButtons[index].click();
      select.value = "";
    });
    wrap.appendChild(select);
    card.appendChild(wrap);
  });
}

function clearCatalogFilters() {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".ac-catalog-filter-panel .ac-filter-chip"));
  buttons.forEach((button) => button.click());
}

function activeChipCount() {
  return document.querySelectorAll(".ac-catalog-filter-panel .ac-filter-chip").length;
}

function makeClearButton(className: string) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `ac-filter-clear ${className}`;
  button.textContent = "Очистить";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    clearCatalogFilters();
  });
  return button;
}

function ensureClearControls() {
  const chipCount = activeChipCount();
  const desktop = document.querySelector<HTMLElement>(".ac-catalog-filter-panel");
  if (desktop) {
    let clear = desktop.querySelector<HTMLButtonElement>(":scope > .ac-filter-clear--desktop");
    if (!clear) {
      clear = makeClearButton("ac-filter-clear--desktop");
      desktop.appendChild(clear);
    }
    clear.hidden = chipCount === 0;
  }

  const sheet = document.querySelector<HTMLElement>(".ac-mobile-filter-sheet");
  if (sheet) {
    const header = sheet.querySelector<HTMLElement>(":scope > div:first-child > div:nth-child(2)");
    if (header) {
      let clear = header.querySelector<HTMLButtonElement>(":scope > .ac-filter-clear--mobile");
      if (!clear) {
        clear = makeClearButton("ac-filter-clear--mobile");
        header.insertBefore(clear, header.lastElementChild);
      }
      clear.hidden = chipCount === 0;
    }
  }

  const tray = document.querySelector<HTMLElement>(".ac-filter-more-button");
  if (tray) {
    let clear = tray.querySelector<HTMLElement>(":scope > .ac-filter-tray-clear");
    if (!clear) {
      clear = document.createElement("span");
      clear.className = "ac-filter-tray-clear";
      clear.textContent = "Очистить";
      clear.setAttribute("role", "button");
      clear.tabIndex = 0;
      const activate = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        clearCatalogFilters();
      };
      clear.addEventListener("click", activate);
      clear.addEventListener("keydown", (event) => {
        const key = (event as KeyboardEvent).key;
        if (key === "Enter" || key === " ") activate(event);
      });
      tray.insertBefore(clear, tray.lastElementChild);
    }
    clear.hidden = chipCount === 0;
  }
}

function decorateCatalogCounts() {
  document.querySelectorAll<HTMLElement>(".ac-catalog-page *").forEach((element) => {
    if (element.dataset.acCountPulse === "1") return;
    const ownText = Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent || "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!/^(Найдено|Нашлось|Нашли)\s*:/i.test(ownText)) return;
    const dot = document.createElement("span");
    dot.className = "ac-catalog-count-pulse";
    dot.setAttribute("aria-hidden", "true");
    element.prepend(dot);
    element.dataset.acCountPulse = "1";
    element.classList.add("ac-catalog-count-with-pulse");
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
      decorateRangeControls();
      ensureClearControls();
      decorateCatalogCounts();
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
