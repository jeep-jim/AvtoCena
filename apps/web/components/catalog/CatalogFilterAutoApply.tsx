"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const FILTER_FORM_SELECTOR = ".ac-catalog-filter-panel, .ac-catalog-filter-drawer";

function formParams(form: HTMLFormElement) {
  const params = new URLSearchParams(window.location.search);
  const data = new FormData(form);
  const present = new Set<string>();

  for (const [key, raw] of data.entries()) {
    if (typeof raw !== "string") continue;
    present.add(key);
    const value = raw.trim();
    if (value) params.set(key, value);
    else params.delete(key);
  }

  for (const name of ["fuel", "powerTo"]) {
    if (!form.querySelector(`input[type="checkbox"][name="${name}"]`)) continue;
    if (!present.has(name)) params.delete(name);
  }

  params.delete("brand");
  params.delete("page");
  params.delete("advanced");
  return params;
}

function simplifyCatalogSummary() {
  const summary = document.querySelector<HTMLElement>(".ac-catalog-page section > .max-w-4xl > p");
  if (!summary) return;
  const text = summary.textContent || "";
  if (/^Найдено:\s*[\d\s]+$/.test(text.trim())) return;
  const matches = [...text.matchAll(/\d[\d\s]*/g)];
  const last = matches.at(-1)?.[0]?.replace(/\s+/g, " ").trim();
  if (last) summary.textContent = `Найдено: ${last}`;
}

export function CatalogFilterAutoApply() {
  const router = useRouter();
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    simplifyCatalogSummary();
    const root = document.querySelector<HTMLElement>(".ac-catalog-page");
    if (!root) return;
    const observer = new MutationObserver(simplifyCatalogSummary);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const navigateFrom = (form: HTMLFormElement) => {
      const params = formParams(form);
      const next = params.toString();
      const current = new URLSearchParams(window.location.search);
      current.delete("brand");
      current.delete("page");
      current.delete("advanced");
      if (current.toString() === next) return;
      router.replace(next ? `/cars?${next}` : "/cars", { scroll: false });
    };

    const schedule = (form: HTMLFormElement, delay = 0) => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = null;
        window.requestAnimationFrame(() => navigateFrom(form));
      }, delay);
    };

    const onSubmit = (event: SubmitEvent) => {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      if (!form?.matches(FILTER_FORM_SELECTOR)) return;
      event.preventDefault();
      schedule(form);
    };

    const onChange = (event: Event) => {
      const target = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement ? event.target : null;
      const form = target?.closest<HTMLFormElement>(FILTER_FORM_SELECTOR);
      if (!target || !form || !target.name) return;
      schedule(form);
    };

    const onInput = (event: Event) => {
      const input = event.target instanceof HTMLInputElement ? event.target : null;
      const form = input?.closest<HTMLFormElement>(FILTER_FORM_SELECTOR);
      if (!input || !form || !input.name) return;
      if (!["search", "text", "number", "tel"].includes(input.type) && !input.inputMode) return;
      schedule(form, 380);
    };

    const onClick = (event: MouseEvent) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>(".ac-filter-option") : null;
      const form = button?.closest<HTMLFormElement>(FILTER_FORM_SELECTOR);
      if (!button || !form) return;
      schedule(form);
    };

    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("change", onChange, true);
    document.addEventListener("input", onInput, true);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("submit", onSubmit, true);
      document.removeEventListener("change", onChange, true);
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("click", onClick, true);
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, [router]);

  return <style>{`
    .ac-catalog-filter-panel .avto-button,
    .ac-catalog-filter-drawer .avto-button {
      display: none !important;
    }
    @media (min-width: 1024px) {
      .ac-catalog-filter-panel > div:first-child {
        grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
      }
      .ac-catalog-filter-panel .ac-advanced-fields > button {
        display: none !important;
      }
    }
  `}</style>;
}
