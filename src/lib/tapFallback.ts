/**
 * Click fallback for iOS browsers that never synthesise `click`.
 *
 * Measured on iOS 26.6 (see the touchdebug captures): a stationary tap on a
 * plain <button> appended to document.body delivers pointerdown, touchstart,
 * touchend and pointerup, with no pointercancel, nothing calling
 * preventDefault, no pointer-events:none ancestor, no GPU-layer involvement and
 * `touch-action` at both `manipulation` and `auto` — and no `click` ever
 * arrives. Everything that depends on `click` is therefore dead, while the
 * playback slider, which runs on pointerdown/pointermove, keeps working.
 *
 * Nothing in the page can fix that, so this bridges the gap: when a tap
 * produces no click, dispatch one.
 *
 * It costs nothing on healthy browsers. The first tap on a real control decides
 * which mode we are in — see a native click and the shim is disabled for the
 * session; see none and it takes over. So a browser that behaves never gets a
 * synthetic event, and the one that does not behave only risks a duplicate on
 * that single probing tap.
 */

/** Only taps that land on something activatable count, and only they get a click. */
const INTERACTIVE =
  'button, a[href], input, select, textarea, label, summary, [role="button"], [role="tab"], [role="option"], [role="menuitem"], [role="switch"], .v-btn, .v-tab, .v-list-item';

/** Beyond this the gesture was a drag or a scroll, not a tap. */
const MOVE_TOLERANCE_PX = 12;
const MAX_TAP_MS = 700;
/** How long to wait for the browser's own click before standing in for it. */
const CLICK_WAIT_MS = 400;

type Mode = 'probing' | 'native' | 'shim';

interface PendingTap {
  target: Element;
  x: number;
  y: number;
  startedAt: number;
  moved: number;
}

export function installTapFallback(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  // Pointer-only devices synthesise clicks natively; there is nothing to bridge.
  if (!('ontouchstart' in window) && navigator.maxTouchPoints === 0) return;

  let mode: Mode = 'probing';
  let pending: PendingTap | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Our own clicks, so observing one is not mistaken for the browser working. */
  const dispatched = new WeakSet<Event>();

  function clearPending() {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  }

  function activatable(target: EventTarget | null): Element | null {
    if (!(target instanceof Element)) return null;
    const el = target.closest(INTERACTIVE);
    if (!el) return null;
    if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return null;
    return el;
  }

  document.addEventListener(
    'touchstart',
    (e) => {
      clearPending();
      const touch = e.touches[0];
      if (!touch || e.touches.length > 1) return;
      if (!(e.target instanceof Element)) return;
      pending = {
        target: e.target,
        x: touch.clientX,
        y: touch.clientY,
        startedAt: Date.now(),
        moved: 0,
      };
    },
    { passive: true, capture: true },
  );

  document.addEventListener(
    'touchmove',
    (e) => {
      const touch = e.touches[0];
      if (!pending || !touch) return;
      pending.moved = Math.max(
        pending.moved,
        Math.hypot(touch.clientX - pending.x, touch.clientY - pending.y),
      );
    },
    { passive: true, capture: true },
  );

  document.addEventListener('touchcancel', clearPending, { passive: true, capture: true });

  document.addEventListener(
    'touchend',
    (e) => {
      const tap = pending;
      pending = null;
      if (!tap || mode === 'native') return;
      // A cancelled default means the page handled this gesture itself.
      if (e.defaultPrevented) return;
      if (tap.moved > MOVE_TOLERANCE_PX) return;
      if (Date.now() - tap.startedAt > MAX_TAP_MS) return;

      const control = activatable(tap.target);
      if (!control) return;

      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        // No click arrived for a clean tap on a real control: stand in for it.
        mode = 'shim';
        const click = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          detail: 1,
          clientX: tap.x,
          clientY: tap.y,
        });
        dispatched.add(click);
        control.dispatchEvent(click);
      }, CLICK_WAIT_MS);
    },
    { passive: true, capture: true },
  );

  document.addEventListener(
    'click',
    (e) => {
      if (dispatched.has(e)) return;
      // The browser produced a click on its own, so it needs no help.
      mode = 'native';
      clearPending();
    },
    { capture: true },
  );
}
