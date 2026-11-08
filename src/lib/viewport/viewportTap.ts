/**
 * Tap detection on a three.js canvas that also carries OrbitControls.
 *
 * Built on pointer events, not `click`: the canvas is left out of the iOS tap
 * fallback (`src/lib/tapFallback.ts` treats it as touch-driven), so on a device
 * that dispatches no compatibility mouse events a `click` would never come.
 *
 * A gesture counts as a tap only when it cannot have moved the camera: a single
 * pointer (a second finger means pinch / pan), released quickly, having barely
 * moved at any point (not merely back where it started). Listeners are passive
 * and never stop propagation, so orbit, pan and zoom behave exactly as before.
 */

export interface ViewportTap {
  clientX: number;
  clientY: number;
  pointerType: string;
}

export interface ViewportTapOptions {
  /** Movement allowed for a mouse click, in CSS px. */
  mouseSlopPx?: number;
  /** Movement allowed for a finger or pen tap, in CSS px. */
  touchSlopPx?: number;
  /** Longer presses are holds, not taps. */
  maxDurationMs?: number;
}

/** The pointer-event fields this module reads (so tests can drive it with plain events). */
interface PointerLike {
  pointerId: number;
  pointerType: string;
  button: number;
  clientX: number;
  clientY: number;
}

interface Press {
  x: number;
  y: number;
  at: number;
  moved: number;
}

export function onViewportTap(
  target: EventTarget,
  onTap: (tap: ViewportTap) => void,
  options: ViewportTapOptions = {},
): () => void {
  const mouseSlop = options.mouseSlopPx ?? 5;
  const touchSlop = options.touchSlopPx ?? 10;
  const maxDuration = options.maxDurationMs ?? 600;
  const presses = new Map<number, Press>();
  /** Set once a second pointer joins the gesture; cleared when all are up. */
  let multiTouch = false;

  const down = (event: Event) => {
    const e = event as unknown as PointerLike;
    if (e.pointerType === 'mouse' && e.button !== 0) return; // pan / context menu
    presses.set(e.pointerId, { x: e.clientX, y: e.clientY, at: performance.now(), moved: 0 });
    if (presses.size > 1) multiTouch = true;
  };
  const move = (event: Event) => {
    const e = event as unknown as PointerLike;
    const press = presses.get(e.pointerId);
    if (press) press.moved = Math.max(press.moved, Math.hypot(e.clientX - press.x, e.clientY - press.y));
  };
  const up = (event: Event) => {
    const e = event as unknown as PointerLike;
    const press = presses.get(e.pointerId);
    presses.delete(e.pointerId);
    const wasMulti = multiTouch;
    if (presses.size === 0) multiTouch = false;
    if (!press || wasMulti) return;
    const slop = e.pointerType === 'mouse' ? mouseSlop : touchSlop;
    const moved = Math.max(press.moved, Math.hypot(e.clientX - press.x, e.clientY - press.y));
    if (moved > slop || performance.now() - press.at > maxDuration) return;
    onTap({ clientX: e.clientX, clientY: e.clientY, pointerType: e.pointerType });
  };
  const cancel = (event: Event) => {
    presses.delete((event as unknown as PointerLike).pointerId);
    if (presses.size === 0) multiTouch = false;
  };

  const opts: AddEventListenerOptions = { passive: true };
  target.addEventListener('pointerdown', down, opts);
  target.addEventListener('pointermove', move, opts);
  target.addEventListener('pointerup', up, opts);
  target.addEventListener('pointercancel', cancel, opts);
  return () => {
    target.removeEventListener('pointerdown', down);
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', cancel);
  };
}
