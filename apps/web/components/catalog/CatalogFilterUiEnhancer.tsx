"use client";

import { useEffect } from "react";

function setImportant(element: HTMLElement, property: string, value: string) {
  element.style.setProperty(property, value, "important");
}

function clearAdaptiveStyle(element: HTMLElement) {
  for (const property of ["position", "left", "right", "top", "bottom", "width", "max-height", "overflow-y", "z-index", "margin"]) {
    element.style.removeProperty(property);
  }
  const list = element.querySelector<HTMLElement>(":scope > .ac-hide-scrollbar");
  list?.style.removeProperty("max-height");
  list?.style.removeProperty("overflow-y");
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
    const plain = (title.dataset.acRangeTitle || title.textContent || "").trim();
    if (plain === "Объём двигателя") title.dataset.acMobileTitle = "Объём";
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

type RangeChoice = { value: string; label: string };

function rangeChoices(title: string): RangeChoice[] {
  const normalized = title === "Объём" ? "Объём двигателя" : title;
  if (normalized === "Год") {
    const current = new Date().getFullYear();
    return Array.from({ length: Math.max(1, current - 2019) }, (_, index) => {
      const year = current - index;
      return { value: String(year), label: String(year) };
    });
  }
  if (normalized === "Цена") {
    return [
      ["1000000", "1 млн"], ["1500000", "1,5 млн"], ["2000000", "2 млн"], ["2500000", "2,5 млн"],
      ["3000000", "3 млн"], ["4000000", "4 млн"], ["5000000", "5 млн"], ["6000000", "6 млн"],
      ["8000000", "8 млн"], ["10000000", "10 млн"],
    ].map(([value, label]) => ({ value, label }));
  }
  if (normalized === "Пробег") {
    return [
      ["0", "0"], ["20000", "20 тыс."], ["50000", "50 тыс."], ["100000", "100 тыс."],
      ["150000", "150 тыс."], ["200000", "200 тыс."], ["300000", "300 тыс."],
    ].map(([value, label]) => ({ value, label }));
  }
  return [
    ["1000", "1,0 л"], ["1500", "1,5 л"], ["2000", "2,0 л"], ["2500", "2,5 л"],
    ["3000", "3,0 л"], ["3500", "3,5 л"], ["4000", "4,0 л"], ["5000", "5,0 л"],
  ].map(([value, label]) => ({ value, label }));
}

function setReactInputValue(input: HTMLInputElement, value: string) {
  const ownSetter = Object.getOwnPropertyDescriptor(input, "value")?.set;
  const prototype = Object.getPrototypeOf(input) as HTMLInputElement;
  const prototypeSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (prototypeSetter && ownSetter !== prototypeSetter) prototypeSetter.call(input, value);
  else if (ownSetter) ownSetter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  window.requestAnimationFrame(() => {
    input.focus({ preventScroll: true });
    input.blur();
  });
}

function closeRangeMenus(except?: HTMLElement) {
  document.querySelectorAll<HTMLElement>(".ac-range-value-menu.is-open").forEach((menu) => {
    if (menu === except) return;
    menu.classList.remove("is-open", "is-up");
    const toggle = menu.parentElement?.querySelector<HTMLButtonElement>(":scope > .ac-range-value-toggle");
    toggle?.setAttribute("aria-expanded", "false");
  });
}

function positionRangeMenu(menu: HTMLElement, box: HTMLElement) {
  const rect = box.getBoundingClientRect();
  const sheet = box.closest<HTMLElement>(".ac-mobile-filter-sheet");
  const scrollHost = sheet ? box.closest<HTMLElement>(".ac-mobile-filter-sheet > .ac-hide-scrollbar") : null;
  const boundary = (scrollHost || sheet)?.getBoundingClientRect();
  const topBoundary = boundary ? Math.max(8, boundary.top + 5) : 8;
  const bottomBoundary = boundary ? Math.min(window.innerHeight - 8, boundary.bottom - 5) : window.innerHeight - 8;
  const gap = 5;
  const below = Math.max(0, bottomBoundary - rect.bottom - gap);
  const above = Math.max(0, rect.top - topBoundary - gap);
  const desired = Math.min(286, Math.max(92, menu.scrollHeight || 220));
  const openUp = below < Math.min(desired, 170) && above > below;
  const available = Math.max(92, openUp ? above : below);
  setImportant(menu, "max-height", `${Math.min(desired, available)}px`);
  menu.classList.toggle("is-up", openUp);
}

function ensureRangeFieldMenu(box: HTMLElement, title: string) {
  const input = box.querySelector<HTMLInputElement>(":scope > input");
  if (!input) return;
  box.classList.add("ac-range-input-box--menu");

  let toggle = box.querySelector<HTMLButtonElement>(":scope > .ac-range-value-toggle");
  let menu = box.querySelector<HTMLElement>(":scope > .ac-range-value-menu");
  if (!toggle) {
    toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "ac-range-value-toggle";
    toggle.setAttribute("aria-label", `Выбрать значение: ${input.getAttribute("aria-label") || title}`);
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    box.appendChild(toggle);
  }
  if (!menu) {
    menu = document.createElement("div");
    menu.className = "ac-range-value-menu";
    menu.setAttribute("role", "listbox");
    const any = document.createElement("button");
    any.type = "button";
    any.className = "ac-range-value-option";
    any.textContent = "Не важно";
    any.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setReactInputValue(input, "");
      closeRangeMenus();
    });
    menu.appendChild(any);
    rangeChoices(title).forEach((choice) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "ac-range-value-option";
      option.dataset.value = choice.value;
      option.textContent = choice.label;
      option.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        setReactInputValue(input, choice.value);
        closeRangeMenus();
      });
      menu?.appendChild(option);
    });
    box.appendChild(menu);
  }

  if (toggle.dataset.acBound !== "1") {
    toggle.dataset.acBound = "1";
    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!menu) return;
      const willOpen = !menu.classList.contains("is-open");
      closeRangeMenus(menu);
      menu.classList.toggle("is-open", willOpen);
      toggle?.setAttribute("aria-expanded", willOpen ? "true" : "false");
      if (willOpen) window.requestAnimationFrame(() => positionRangeMenu(menu!, box));
    });
  }
}

function decorateRangeControls() {
  document.querySelectorAll<HTMLElement>(".ac-catalog-filter-panel .ac-range-card, .ac-mobile-filter-sheet .ac-range-card").forEach((card) => {
    const title = card.querySelector<HTMLElement>(":scope > div:first-child > div:first-child > div:first-child");
    if (!title) return;
    const stored = (title.dataset.acRangeTitle || title.textContent || "").replace(/\s+/g, " ").trim();
    const plainTitle = stored === "Объём" ? "Объём двигателя" : stored;
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
    const label = title.querySelector<HTMLElement>(":scope > .ac-range-title-label");
    if (!label) {
      const textNodes = Array.from(title.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE);
      const text = textNodes.map((node) => node.textContent || "").join(" ").trim() || plainTitle;
      textNodes.forEach((node) => node.remove());
      const span = document.createElement("span");
      span.className = "ac-range-title-label";
      span.textContent = card.closest(".ac-mobile-filter-sheet") && plainTitle === "Объём двигателя" ? "Объём" : text;
      title.appendChild(span);
    }

    card.querySelector<HTMLElement>(":scope > .ac-range-preset-select-wrap")?.remove();
    card.querySelectorAll<HTMLElement>(".ac-range-input-box").forEach((box) => ensureRangeFieldMenu(box, plainTitle));
  });
}

function decorateFieldStates() {
  document.querySelectorAll<HTMLElement>(".ac-catalog-filter-panel, .ac-mobile-filter-sheet").forEach((scope) => {
    scope.querySelectorAll<HTMLInputElement>('input[type="hidden"][name]').forEach((hidden) => {
      if (hidden.name === "sort") return;
      const parent = hidden.parentElement;
      const control = parent?.querySelector<HTMLElement>(":scope > .ac-filter-control");
      if (!control) return;
      control.classList.add("ac-stateful-control");
      control.classList.toggle("is-filled", Boolean(hidden.value.trim()));
    });
    scope.querySelectorAll<HTMLInputElement>('input.ac-filter-control[name="model"]').forEach((input) => {
      input.classList.add("ac-stateful-control");
      input.classList.toggle("is-filled", Boolean(input.value.trim()));
    });
    scope.querySelectorAll<HTMLElement>(".ac-range-card").forEach((card) => {
      const filled = Array.from(card.querySelectorAll<HTMLInputElement>(".ac-range-input-box input")).some((input) => Boolean(input.value.trim()));
      card.classList.toggle("is-filled", filled);
      card.querySelectorAll<HTMLElement>(".ac-range-input-box").forEach((box) => {
        const input = box.querySelector<HTMLInputElement>(":scope > input");
        box.classList.toggle("is-filled", Boolean(input?.value.trim()));
      });
    });
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

function mobileHasSelectedParameter(sheet: HTMLElement) {
  return Array.from(sheet.querySelectorAll<HTMLInputElement>("input[name]")).some((input) => {
    if (input.type === "checkbox") return input.checked;
    return Boolean(String(input.value || "").trim());
  });
}

function updateMobileCloseAction(sheet: HTMLElement) {
  const header = sheet.querySelector<HTMLElement>(":scope > div:first-child > div:nth-child(2)");
  if (!header) return;
  const close = header.querySelector<HTMLButtonElement>('button[data-ac-mobile-close="1"], button[aria-label="Закрыть"]');
  if (!close) return;
  close.dataset.acMobileClose = "1";
  const apply = mobileHasSelectedParameter(sheet);
  close.classList.toggle("ac-mobile-apply", apply);
  close.textContent = apply ? "✓" : "×";
  close.setAttribute("aria-label", apply ? "Применить и закрыть" : "Закрыть");
  close.setAttribute("title", apply ? "Применить" : "Закрыть");
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
    updateMobileCloseAction(sheet);
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
  const gap = 6;
  const below = Math.max(0, viewportBottom - anchorRect.bottom - gap);
  const above = Math.max(0, anchorRect.top - viewportTop - gap);
  const measured = Math.max(120, Math.min(380, dropdown.scrollHeight || 320));
  const openUp = below < Math.min(measured, 210) && above > below;
  const available = Math.max(112, openUp ? above : below);
  const maxHeight = Math.min(measured, available, 380);

  dropdown.dataset.acAdaptive = "1";
  dropdown.dataset.acDropDirection = openUp ? "up" : "down";
  setImportant(dropdown, "position", "absolute");
  setImportant(dropdown, "left", "0");
  setImportant(dropdown, "right", "0");
  setImportant(dropdown, "width", "100%");
  setImportant(dropdown, "max-height", `${Math.round(maxHeight)}px`);
  setImportant(dropdown, "overflow-y", "hidden");
  setImportant(dropdown, "z-index", "10090");
  setImportant(dropdown, "margin", "0");
  if (openUp) {
    setImportant(dropdown, "top", "auto");
    setImportant(dropdown, "bottom", `calc(100% + ${gap}px)`);
  } else {
    setImportant(dropdown, "bottom", "auto");
    setImportant(dropdown, "top", `calc(100% + ${gap}px)`);
  }

  const list = dropdown.querySelector<HTMLElement>(":scope > .ac-hide-scrollbar");
  if (list) {
    const hasSearch = Boolean(dropdown.querySelector(":scope > div:not(.ac-hide-scrollbar) input"));
    setImportant(list, "max-height", `${Math.max(86, Math.round(maxHeight - (hasSearch ? 56 : 12)))}px`);
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
      decorateFieldStates();
      ensureClearControls();
      decorateCatalogCounts();
      document.querySelectorAll<HTMLElement>(".ac-mobile-filter-sheet .ac-filter-dropdown").forEach(positionMobileDropdown);
    };
    const requestRefresh = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(refresh);
    };
    const closeMenus = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".ac-range-input-box--menu")) return;
      closeRangeMenus();
    };

    refresh();
    const observer = new MutationObserver(requestRefresh);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("input", requestRefresh, true);
    document.addEventListener("change", requestRefresh, true);
    document.addEventListener("pointerdown", closeMenus, true);
    window.addEventListener("resize", requestRefresh);
    window.addEventListener("scroll", requestRefresh, true);

    return () => {
      observer.disconnect();
      document.removeEventListener("input", requestRefresh, true);
      document.removeEventListener("change", requestRefresh, true);
      document.removeEventListener("pointerdown", closeMenus, true);
      window.removeEventListener("resize", requestRefresh);
      window.removeEventListener("scroll", requestRefresh, true);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
