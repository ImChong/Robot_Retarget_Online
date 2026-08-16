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
 * The decision is made per tap, never once per session. An earlier version
 * latched a session-wide "this browser is fine" flag the first time it saw any
 * click it had not sent itself, which the device then disproved: one late click
 * — arriving after the tap that caused it had already been forgotten — switched
 * the shim off for good, so a single control worked once and everything
 * afterwards stayed dead.
 *
 * Per-tap needs no such flag. On a healthy browser the click lands within a few
 * tens of milliseconds, well inside the wait, and cancels the pending timer, so
 * nothing synthetic is ever dispatched. Only silence produces a click.
 */

/** Only taps that land on something activatable count, and only they get a click. */
const INTERACTIVE =
  'button, a[href], input, select, textarea, label, summary, [role="button"], [role="tab"], [role="option"], [role="menuitem"], [role="switch"], .v-btn, .v-tab, .v-list-item';

/** Beyond this the gesture was a drag or a scroll, not a tap. */
const MOVE_TOLERANCE_PX = 12;
const MAX_TAP_MS = 700;
/** How long to wait for the browser's own click before standing in for it. */
const CLICK_WAIT_MS = 400;
/**
 * A browser that delivers clicks later than the wait would activate twice, so a
 * native click landing this soon after one we sent for the same control is
 * treated as the duplicate and dropped.
 */
const DUPLICATE_WINDOW_MS = 900;

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

  let pending: PendingTap | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Our own clicks, so we never mistake one for the browser's. */
  const dispatched = new WeakSet<Event>();
  /** The most recent click we stood in for, to catch a late native duplicate. */
  let standIn: { control: Element; at: number } | null = null;

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
      if (!tap) return;
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
        standIn = { control, at: Date.now() };
        control.dispatchEvent(click);
      }, CLICK_WAIT_MS);
    },
    { passive: true, capture: true },
  );

  document.addEventListener(
    'click',
    (e) => {
      if (dispatched.has(e)) return;

      // The browser got there first, so the tap needs no stand-in.
      clearPending();

      // A browser slower than CLICK_WAIT_MS would otherwise activate the control
      // twice; drop the straggler rather than let it toggle state back.
      if (
        standIn &&
        Date.now() - standIn.at < DUPLICATE_WINDOW_MS &&
        e.target instanceof Node &&
        (standIn.control === e.target || standIn.control.contains(e.target))
      ) {
        standIn = null;
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    },
    { capture: true },
  );
}
