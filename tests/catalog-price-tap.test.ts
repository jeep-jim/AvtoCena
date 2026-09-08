import assert from "node:assert/strict";
import test from "node:test";
import { createTapActivation } from "../apps/web/components/catalog/useTapActivation";

const point = (x: number, y: number) => ({ clientX: x, clientY: y, isPrimary: true }) as any;
function blocked(guard: ReturnType<typeof createTapActivation>, detail = 1) {
  let prevented = false;
  let stopped = false;
  guard.onClickCapture({ detail, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } } as any);
  assert.equal(prevented, stopped);
  return prevented;
}
test("a tap tolerates finger jitter, but dragging across a price never opens it", () => {
  const guard = createTapActivation(() => 0);
  guard.onPointerDownCapture(point(50, 100));
  guard.onPointerMoveCapture(point(52, 103));
  assert.equal(blocked(guard), false);
  guard.onPointerMoveCapture(point(50, 140));
  guard.onPointerMoveCapture(point(50, 100));
  assert.equal(blocked(guard), true);
});
test("native scroll cancellation and ghost clicks are blocked, while the next tap works", () => {
  const guard = createTapActivation(() => 0);
  guard.onPointerDownCapture(point(50, 100));
  guard.onPointerCancelCapture();
  assert.equal(blocked(guard), true);
  assert.equal(blocked(guard), true);
  guard.onPointerDownCapture(point(50, 100));
  assert.equal(blocked(guard), false);
});
test("scroll offset is checked even without a pointer-move event; keyboard still works", () => {
  let scroll = 0;
  const guard = createTapActivation(() => scroll);
  guard.onPointerDownCapture(point(50, 100));
  scroll = 200;
  assert.equal(blocked(guard), true);
  assert.equal(blocked(guard, 0), false);
});
