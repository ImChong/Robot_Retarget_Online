/**
 * Mouse-event fallback for iOS browsers that never synthesise them.
 *
 * Measured on iOS 26.6 (see the touchdebug captures): a stationary tap on a
 * plain <button> appended to document.body delivers pointerdown, touchstart,
 * touchend and pointerup, with no pointercancel, nothing calling
 * preventDefault, no pointer-events:none ancestor, no GPU-layer involvement and
 * `touch-action` at both `manipulation` and `auto` — and no `click` ever
 * arrives. The compatibility mouse events a tap owes the page (mousedown,
 * mouseup, click) are simply absent, so everything built on them is dead, while
 * the playback slider, which runs on touch/pointer events, keeps working.
 *
 * Nothing in the page can fix that, so this bridges the gap: when a tap
 * produces no mouse events, dispatch them.
 *
 * All three matter, not `click` alone:
 *   - Vuetify opens a `v-select` from `mousedown` on its field and never from
 *     `click`, so the history dropdown could not be opened at all.
 *   - Its click-outside directive closes an overlay only after seeing both a
 *     mousedown *and* a click outside, which is how an open menu is dismissed.
 *   - `click` activates buttons, list items, and the drawer/dialog scrim —
 *     a plain <div>, which is why tapping beside the panel never closed it.
 *
 * The stand-in therefore covers any element, not only activatable ones: the
 * scrim, blank space beside an open menu and table rows with their own click
 * handlers are exactly the taps that need it. Controls that already drive
 * themselves from touch or pointer events are left alone (see TOUCH_DRIVEN),
 * since a second, synthetic gesture would compete with the real one.
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
 * nothing synthetic is ever dispatched. Only silence produces mouse events.
 */

/** Already driven by touch/pointer events; a synthetic gesture would fight them. */
const TOUCH_DRIVEN = '.v-slider, [role="slider"], canvas';

/** A tap is attributed to the nearest of these, the way a real click would be. */
const ACTIVATABLE =
  'button, a[href], input, select, textarea, label, summary, [role="button"], [role="tab"], [role="option"], [role="menuitem"], [role="switch"], .v-btn, .v-tab, .v-list-item, .v-field';

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
  // Pointer-only devices synthesise mouse events natively; there is nothing to bridge.
  if (!('ontouchstart' in window) && navigator.maxTouchPoints === 0) return;

  let pending: PendingTap | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Our own events, so we never mistake one for the browser's. */
  const dispatched = new WeakSet<Event>();
  /** The most recent click we stood in for, to catch a late native duplicate. */
  let standIn: { control: Element; at: number } | null = null;
  /** When the browser last delivered a mouse event of its own. */
  let nativeMouseAt = 0;

  function clearPending() {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  }

  /** The element a real click would have landed on, or null to stay out of the way. */
  function standInTarget(target: EventTarget | null): Element | null {
    if (!(target instanceof Element)) return null;
    if (target.closest(TOUCH_DRIVEN)) return null;
    const control = target.closest(ACTIVATABLE);
    if (!control) return target;
    if (control.hasAttribute('disabled') || control.getAttribute('aria-disabled') === 'true') {
      return null;
    }
    return control;
  }

  function send(control: Element, type: 'mousedown' | 'mouseup' | 'click', tap: PendingTap) {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      detail: 1,
      clientX: tap.x,
      clientY: tap.y,
      button: 0,
      buttons: type === 'mousedown' ? 1 : 0,
    });
    dispatched.add(event);
    control.dispatchEvent(event);
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

      const control = standInTarget(tap.target);
      if (!control) return;

      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        // No mouse event arrived for a clean tap: stand in for the sequence.
        // A browser that sent mousedown but withheld click needs the click only.
        if (nativeMouseAt < tap.startedAt) {
          send(control, 'mousedown', tap);
          send(control, 'mouseup', tap);
        }
        standIn = { control, at: Date.now() };
        send(control, 'click', tap);
      }, CLICK_WAIT_MS);
    },
    { passive: true, capture: true },
  );

  document.addEventListener(
    'mousedown',
    (e) => {
      if (!dispatched.has(e)) nativeMouseAt = Date.now();
    },
    { passive: true, capture: true },
  );

  document.addEventListener(
    'click',
    (e) => {
      if (dispatched.has(e)) return;
      nativeMouseAt = Date.now();

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
