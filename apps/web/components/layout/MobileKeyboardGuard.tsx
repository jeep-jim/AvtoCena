"use client";

import { useEffect } from "react";

function editableTarget(target: EventTarget | null) {
  const element = target instanceof Element ? target.closest<HTMLElement>("input, textarea, [contenteditable='true']") : null;
  if (!element) return null;
  if (element instanceof HTMLInputElement && (element.disabled || element.readOnly || element.type === "hidden" || element.type === "checkbox" || element.type === "radio" || element.type === "button" || element.type === "submit")) return null;
  if (element instanceof HTMLTextAreaElement && (element.disabled || element.readOnly)) return null;
  return element;
}

export function MobileKeyboardGuard() {
  useEffect(() => {
    const coarse = window.matchMedia?.("(pointer: coarse)");
    let lastDirectEditableTap = 0;

    const isMobilePointer = () => Boolean(coarse?.matches || navigator.maxTouchPoints > 0);

    const pointerDown = (event: PointerEvent) => {
      if (!isMobilePointer()) return;
      const editable = editableTarget(event.target);
      if (editable) {
        lastDirectEditableTap = performance.now();
        return;
      }
      const active = editableTarget(document.activeElement);
      active?.blur();
    };

    const focusIn = (event: FocusEvent) => {
      if (!isMobilePointer()) return;
      const editable = editableTarget(event.target);
      if (!editable) return;
      const directTap = performance.now() - lastDirectEditableTap < 900;
      if (!directTap) requestAnimationFrame(() => editable.blur());
    };

    document.addEventListener("pointerdown", pointerDown, true);
    document.addEventListener("focusin", focusIn, true);
    return () => {
      document.removeEventListener("pointerdown", pointerDown, true);
      document.removeEventListener("focusin", focusIn, true);
    };
  }, []);

  return null;
}
