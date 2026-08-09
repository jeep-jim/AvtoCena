"use client";

import { useEffect } from "react";

type CitySuggestion = { city: string; region?: string };

type DragState = {
  pointerId: number;
  startY: number;
  currentY: number;
  startedAt: number;
};

const POPULAR_CITIES = [
  "Москва",
  "Санкт-Петербург",
  "Новосибирск",
  "Екатеринбург",
  "Казань",
  "Красноярск",
  "Омск",
  "Самара",
  "Челябинск",
  "Ростов-на-Дону",
  "Уфа",
  "Новокузнецк",
  "Барнаул",
  "Иркутск",
  "Владивосток",
];

function cleanText(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function setControlledInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function persistCity(city: string) {
  try { window.localStorage.setItem("avtocena_city", city); } catch { /* storage may be unavailable */ }
  document.cookie = `avtocena_city=${encodeURIComponent(city)}; Max-Age=15552000; Path=/; SameSite=Lax`;
}

function pinSvg() {
  return `
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
      <path d="M12 21s7-5.6 7-12A7 7 0 1 0 5 9c0 6.4 7 12 7 12Z" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" />
      <circle cx="12" cy="9" r="2.6" stroke="currentColor" stroke-width="2.2" />
    </svg>
  `;
}

export function LeadCaptureInteractionEnhancer() {
  useEffect(() => {
    const attached = new Map<HTMLElement, () => void>();

    const attach = (dialog: HTMLElement) => {
      if (attached.has(dialog)) return;
      const backdrop = dialog.closest<HTMLElement>(".ac-lead-dialog-backdrop");
      const wrapper = dialog.parentElement as HTMLElement | null;
      const handle = wrapper?.querySelector<HTMLElement>(".ac-lead-sheet-handle") || null;
      const closeButton = dialog.querySelector<HTMLButtonElement>('button[aria-label="Закрыть"]');
      const cityInput = dialog.querySelector<HTMLInputElement>('input[autocomplete="address-level2"]');
      const cityLabel = cityInput?.closest<HTMLLabelElement>("label") || null;

      let drag: DragState | null = null;
      let suppressHandleClick = false;
      let resetTimer = 0;
      let cityTimer = 0;
      let cityController: AbortController | null = null;
      let cityFocused = false;

      const requestClose = () => {
        if (closeButton && !closeButton.disabled) closeButton.click();
      };

      const resetDrag = () => {
        if (!wrapper) return;
        wrapper.style.transition = "transform 200ms ease-out";
        wrapper.style.transform = "translateY(0px)";
        window.clearTimeout(resetTimer);
        resetTimer = window.setTimeout(() => {
          if (wrapper.isConnected) {
            wrapper.style.removeProperty("transition");
            wrapper.style.removeProperty("transform");
          }
        }, 220);
      };

      const onPointerDown = (event: PointerEvent) => {
        if (!handle || event.currentTarget !== handle || window.matchMedia("(min-width: 768px)").matches) return;
        drag = { pointerId: event.pointerId, startY: event.clientY, currentY: event.clientY, startedAt: performance.now() };
        suppressHandleClick = false;
        wrapper?.style.removeProperty("transition");
        try { handle.setPointerCapture(event.pointerId); } catch { /* capture is best effort */ }
      };

      const onPointerMove = (event: PointerEvent) => {
        if (!drag || drag.pointerId !== event.pointerId || !wrapper) return;
        drag.currentY = event.clientY;
        const distance = Math.max(0, event.clientY - drag.startY);
        if (distance > 5) suppressHandleClick = true;
        wrapper.style.transform = `translateY(${distance}px)`;
      };

      const onPointerEnd = (event: PointerEvent) => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        const distance = Math.max(0, drag.currentY - drag.startY);
        const elapsed = Math.max(1, performance.now() - drag.startedAt);
        drag = null;
        if (distance > 95 || distance / elapsed > 0.65) requestClose();
        else resetDrag();
      };

      const onHandleClick = (event: MouseEvent) => {
        if (!suppressHandleClick) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        suppressHandleClick = false;
      };

      handle?.addEventListener("pointerdown", onPointerDown);
      handle?.addEventListener("pointermove", onPointerMove);
      handle?.addEventListener("pointerup", onPointerEnd);
      handle?.addEventListener("pointercancel", onPointerEnd);
      handle?.addEventListener("click", onHandleClick, true);

      let cityButton: HTMLButtonElement | null = null;
      let suggestionBox: HTMLDivElement | null = null;

      const restoreViewport = () => {
        if (!backdrop) return;
        backdrop.style.removeProperty("top");
        backdrop.style.removeProperty("bottom");
        backdrop.style.removeProperty("height");
        dialog.style.removeProperty("max-height");
      };

      const liftCityField = () => {
        if (!cityInput || !cityLabel || window.matchMedia("(min-width: 768px)").matches) return;
        const viewport = window.visualViewport;
        if (backdrop && viewport) {
          const height = Math.max(320, Math.floor(viewport.height));
          backdrop.style.top = `${Math.max(0, Math.floor(viewport.offsetTop))}px`;
          backdrop.style.bottom = "auto";
          backdrop.style.height = `${height}px`;
          dialog.style.maxHeight = `${Math.max(300, height - 10)}px`;
        }
        window.requestAnimationFrame(() => {
          if (!cityLabel.isConnected) return;
          const targetTop = Math.max(0, cityLabel.offsetTop - 18);
          dialog.scrollTo({ top: targetTop, behavior: "smooth" });
        });
      };

      const hideSuggestions = () => {
        suggestionBox?.classList.remove("is-open");
      };

      const chooseCity = (city: string) => {
        const normalized = cleanText(city).replace(/^г\.?\s*/i, "");
        if (!normalized || !cityInput) return;
        setControlledInputValue(cityInput, normalized);
        persistCity(normalized);
        hideSuggestions();
        cityInput.blur();
      };

      const renderSuggestions = (items: CitySuggestion[]) => {
        if (!suggestionBox) return;
        suggestionBox.replaceChildren();
        if (!items.length) {
          suggestionBox.classList.remove("is-open");
          return;
        }
        for (const item of items.slice(0, 10)) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "ac-lead-city-option";
          const city = document.createElement("span");
          city.className = "ac-lead-city-option__city";
          city.textContent = item.city;
          const region = document.createElement("span");
          region.className = "ac-lead-city-option__region";
          region.textContent = cleanText(item.region);
          button.append(city, region);
          button.addEventListener("pointerdown", (event) => event.preventDefault());
          button.addEventListener("click", () => chooseCity(item.city));
          suggestionBox.appendChild(button);
        }
        suggestionBox.classList.add("is-open");
        liftCityField();
      };

      const loadCitySuggestions = (rawQuery: string) => {
        const query = cleanText(rawQuery);
        cityController?.abort();
        window.clearTimeout(cityTimer);
        if (query.length < 2) {
          renderSuggestions(POPULAR_CITIES.slice(0, 10).map((city) => ({ city })));
          return;
        }
        cityTimer = window.setTimeout(async () => {
          cityController = new AbortController();
          try {
            const response = await fetch(`/api/location/city?q=${encodeURIComponent(query)}`, { cache: "no-store", signal: cityController.signal });
            if (!response.ok) return;
            const data = await response.json();
            const items = (Array.isArray(data?.suggestions) ? data.suggestions : [])
              .map((item: any) => ({ city: cleanText(item?.city), region: cleanText(item?.region) }))
              .filter((item: CitySuggestion) => Boolean(item.city));
            if (cityFocused) renderSuggestions(items.length ? items : POPULAR_CITIES.filter((city) => city.toLocaleLowerCase("ru-RU").includes(query.toLocaleLowerCase("ru-RU"))).map((city) => ({ city })));
          } catch (error) {
            if ((error as Error)?.name !== "AbortError" && cityFocused) renderSuggestions([]);
          }
        }, 180);
      };

      if (cityInput && cityLabel) {
        cityLabel.classList.add("ac-lead-city-field");
        cityInput.classList.add("ac-lead-city-input");

        cityButton = document.createElement("button");
        cityButton.type = "button";
        cityButton.className = "ac-lead-city-button";
        cityButton.setAttribute("aria-label", "Выбрать город из подсказок");
        cityButton.title = "Выбрать город";
        cityButton.innerHTML = pinSvg();
        cityLabel.appendChild(cityButton);

        suggestionBox = document.createElement("div");
        suggestionBox.className = "ac-lead-city-suggestions ac-hide-scrollbar";
        cityLabel.appendChild(suggestionBox);

        const onCityFocus = () => {
          cityFocused = true;
          loadCitySuggestions(cityInput.value);
          liftCityField();
        };
        const onCityInput = () => {
          cityFocused = true;
          loadCitySuggestions(cityInput.value);
          liftCityField();
        };
        const onCityBlur = () => {
          window.setTimeout(() => {
            cityFocused = false;
            hideSuggestions();
            restoreViewport();
          }, 150);
        };
        const onCityButton = (event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
          cityInput.focus({ preventScroll: true });
          cityFocused = true;
          loadCitySuggestions(cityInput.value);
          liftCityField();
        };
        const onViewportChange = () => { if (cityFocused) liftCityField(); };

        cityInput.addEventListener("focus", onCityFocus);
        cityInput.addEventListener("input", onCityInput);
        cityInput.addEventListener("blur", onCityBlur);
        cityButton.addEventListener("click", onCityButton);
        window.visualViewport?.addEventListener("resize", onViewportChange);
        window.visualViewport?.addEventListener("scroll", onViewportChange);

        const cleanupCity = () => {
          cityInput.removeEventListener("focus", onCityFocus);
          cityInput.removeEventListener("input", onCityInput);
          cityInput.removeEventListener("blur", onCityBlur);
          cityButton?.removeEventListener("click", onCityButton);
          window.visualViewport?.removeEventListener("resize", onViewportChange);
          window.visualViewport?.removeEventListener("scroll", onViewportChange);
        };

        attached.set(dialog, () => {
          cleanupCity();
          handle?.removeEventListener("pointerdown", onPointerDown);
          handle?.removeEventListener("pointermove", onPointerMove);
          handle?.removeEventListener("pointerup", onPointerEnd);
          handle?.removeEventListener("pointercancel", onPointerEnd);
          handle?.removeEventListener("click", onHandleClick, true);
          cityController?.abort();
          window.clearTimeout(cityTimer);
          window.clearTimeout(resetTimer);
          restoreViewport();
          cityButton?.remove();
          suggestionBox?.remove();
        });
        return;
      }

      attached.set(dialog, () => {
        handle?.removeEventListener("pointerdown", onPointerDown);
        handle?.removeEventListener("pointermove", onPointerMove);
        handle?.removeEventListener("pointerup", onPointerEnd);
        handle?.removeEventListener("pointercancel", onPointerEnd);
        handle?.removeEventListener("click", onHandleClick, true);
        window.clearTimeout(resetTimer);
      });
    };

    const scan = () => {
      document.querySelectorAll<HTMLElement>(".ac-lead-dialog").forEach(attach);
      for (const [dialog, cleanup] of [...attached]) {
        if (!dialog.isConnected) {
          cleanup();
          attached.delete(dialog);
        }
      }
    };

    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    scan();

    return () => {
      observer.disconnect();
      for (const cleanup of attached.values()) cleanup();
      attached.clear();
    };
  }, []);

  return <style jsx global>{`
    .ac-lead-sheet-handle { touch-action: none !important; cursor: grab; }
    .ac-lead-sheet-handle:active { cursor: grabbing; }
    .ac-lead-city-field { position: relative !important; z-index: 90; }
    .ac-lead-city-input { padding-right: 3.4rem !important; }
    .ac-lead-city-button {
      position: absolute;
      right: .65rem;
      top: 1.72rem;
      z-index: 3;
      display: flex;
      width: 2.35rem;
      height: 2.35rem;
      align-items: center;
      justify-content: center;
      border: 0;
      border-radius: .8rem;
      background: transparent;
      color: #ef3340;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    .ac-lead-city-button:active { transform: scale(.94); }
    .ac-lead-city-suggestions {
      position: absolute;
      top: calc(100% + .45rem);
      left: 0;
      right: 0;
      z-index: 220;
      display: none;
      max-height: min(250px, 34dvh);
      overflow-y: auto;
      border-radius: 1rem;
      padding: .4rem;
      background: var(--ac-surface-3);
      box-shadow: 0 18px 48px rgba(0,0,0,.28);
    }
    .ac-lead-city-suggestions.is-open { display: block; }
    .ac-lead-city-option {
      display: grid;
      width: 100%;
      grid-template-columns: minmax(0,1fr) auto;
      align-items: center;
      gap: .75rem;
      min-height: 2.8rem;
      border: 0;
      border-radius: .8rem;
      padding: .65rem .75rem;
      background: transparent;
      color: var(--ac-text);
      text-align: left;
      cursor: pointer;
    }
    .ac-lead-city-option:hover { background: rgba(255,255,255,.07); }
    .ac-lead-city-option__city { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .9rem; font-weight: 900; }
    .ac-lead-city-option__region { max-width: 13rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .7rem; font-weight: 700; color: var(--ac-muted); }
    html[data-theme="light"] .ac-lead-city-suggestions { background: #f7f8fb; box-shadow: 0 18px 48px rgba(38,43,57,.18); }
    html[data-theme="light"] .ac-lead-city-option:hover { background: #e8ecf2; }
    @media (max-width: 767px) {
      .ac-lead-city-suggestions { max-height: 220px; }
    }
  `}</style>;
}
