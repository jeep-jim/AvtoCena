"use client";

import { useEffect, type ReactNode } from "react";

export default function PublicTemplate({ children }: { children: ReactNode }) {
  useEffect(() => {
    const closeOpenDetails = (target?: EventTarget | null) => {
      const node = target instanceof Node ? target : null;
      document.querySelectorAll<HTMLDetailsElement>("details[open]").forEach((details) => {
        if (!node || !details.contains(node)) details.removeAttribute("open");
      });
    };

    const pointerDown = (event: PointerEvent) => {
      closeOpenDetails(event.target);
      window.dispatchEvent(new CustomEvent("avtocena:dismiss-tooltips", { detail: { target: event.target } }));
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeOpenDetails();
      window.dispatchEvent(new CustomEvent("avtocena:dismiss-tooltips"));
    };

    document.addEventListener("pointerdown", pointerDown, true);
    window.addEventListener("keydown", keyDown);
    return () => {
      document.removeEventListener("pointerdown", pointerDown, true);
      window.removeEventListener("keydown", keyDown);
    };
  }, []);

  return children;
}
