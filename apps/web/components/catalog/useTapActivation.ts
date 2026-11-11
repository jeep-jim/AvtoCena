"use client";

import { useRef, type MouseEvent, type PointerEvent } from "react";

/** A scroll/drag must never become a price-panel click, including ghost clicks. */
export function createTapActivation(getScrollY = () => window.scrollY) {
  let gesture = { x: 0, y: 0, scrollY: 0, dragged: false };
  return {
    onPointerDownCapture(event: PointerEvent<HTMLElement>) {
      gesture = { x: event.clientX, y: event.clientY, scrollY: getScrollY(), dragged: !event.isPrimary };
    },
    onPointerMoveCapture(event: PointerEvent<HTMLElement>) {
      const start = gesture;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) start.dragged = true;
    },
    onPointerCancelCapture() { gesture.dragged = true; },
    onClickCapture(event: MouseEvent<HTMLElement>) {
      // Keyboard and assistive-technology activation do not carry a pointer click count.
      if (event.detail === 0) return;
      if (gesture.dragged || Math.abs(getScrollY() - gesture.scrollY) > 8) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
  };
}

export function useTapActivation() {
  return useRef(createTapActivation()).current;
}
