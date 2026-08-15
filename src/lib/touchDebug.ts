/**
 * On-device touch diagnostics for iOS Safari.
 *
 * Buttons can report a tap highlight yet never activate, which means the touch
 * reached the element but no `click` was synthesised. Safari only exposes why on
 * the device itself, so this overlay records what actually happens across one
 * tap and prints it on screen — no desktop Web Inspector needed.
 *
 * Inert unless the URL contains `touchdebug` (works with the hash router, e.g.
 * `/Robot_Retarget_Online/?touchdebug=1#/preview`). All listeners are passive
 * and capture-phase, and the panel is `pointer-events: none`, so enabling it
 * cannot change the behaviour it is measuring.
 */

const MAX_LINES = 16;
/** A synthesised click follows touchend closely; past this it is not coming. */
const CLICK_GRACE_MS = 500;

export function isTouchDebugEnabled(): boolean {
  return typeof window !== 'undefined' && window.location.href.includes('touchdebug');
}

function describe(el: EventTarget | null): string {
  if (!(el instanceof Element)) return String(el);
  const cls = el.className;
  const name = typeof cls === 'string' ? cls.split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '';
  return `${el.tagName.toLowerCase()}${name ? `.${name}` : ''}`;
}

/** touch-action resolves as the intersection from the element up to the root. */
function resolvedTouchAction(el: Element | null): string {
  const rank: Record<string, number> = { auto: 0, manipulation: 1, 'pan-x': 2, 'pan-y': 2, none: 3 };
  let node: Element | null = el;
  let strictest = 'auto';
  while (node) {
    const ta = getComputedStyle(node).touchAction;
    if ((rank[ta] ?? 0) > (rank[strictest] ?? 0)) strictest = ta;
    node = node.parentElement;
  }
  return strictest;
}

/** First ancestor that opts out of hit-testing, if any. */
function blockingAncestor(el: Element | null): string | null {
  let node: Element | null = el;
  while (node) {
    if (getComputedStyle(node).pointerEvents === 'none') return describe(node);
    node = node.parentElement;
  }
  return null;
}

interface TapRecord {
  target: string;
  x: number;
  y: number;
  scrollY: number;
  vvTop: number;
  vvHeight: number;
  startedAt: number;
  moved: number;
  sawPointerDown: boolean;
  sawPointerUp: boolean;
  sawTouchEnd: boolean;
  sawCancel: string | null;
  preventedOn: string[];
}

export function installTouchDebug(): void {
  if (!isTouchDebugEnabled()) return;

  const panel = document.createElement('pre');
  panel.setAttribute('aria-hidden', 'true');
  // Floats over the 3D viewport, which holds no controls, so the header,
  // workflow nav, playback bar and bottom nav all stay visible while testing.
  panel.style.cssText = [
    'position:fixed',
    'left:0',
    'right:0',
    'top:28%',
    'z-index:2147483647',
    'margin:0',
    'padding:6px 8px',
    'max-height:38vh',
    'overflow:hidden',
    'pointer-events:none',
    'background:rgba(0,0,0,0.82)',
    'color:#8ef',
    'font:10px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace',
    'white-space:pre-wrap',
    'word-break:break-word',
  ].join(';');
  document.body.appendChild(panel);

  const lines: string[] = [];
  function emit(line: string) {
    lines.push(line);
    if (lines.length > MAX_LINES) lines.shift();
    panel.textContent = lines.join('\n');
  }

  const vv = window.visualViewport;
  function env(): string {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:100dvh;visibility:hidden';
    document.body.appendChild(probe);
    const dvh = Math.round(probe.getBoundingClientRect().height);
    probe.remove();
    const doc = document.documentElement;
    const scrollable = doc.scrollHeight > doc.clientHeight + 1;
    return [
      `vp ${window.innerWidth}x${window.innerHeight} dvh ${dvh} vv ${Math.round(vv?.height ?? 0)}`,
      `doc ${doc.scrollHeight}/${doc.clientHeight} scrollable=${scrollable}`,
      `htmlOverflowY=${getComputedStyle(doc).overflowY}`,
    ].join(' | ');
  }
  emit(`[env] ${env()}`);
  emit(`[ua] ${navigator.userAgent.slice(0, 90)}`);
  emit('[ready] tap a button that does not work');

  let tap: TapRecord | null = null;
  let clickTimer: ReturnType<typeof setTimeout> | null = null;

  const on = (type: string, fn: (e: Event) => void) =>
    document.addEventListener(type, fn, { capture: true, passive: true });

  on('touchstart', (e) => {
    const te = e as TouchEvent;
    const t = te.touches[0];
    if (!t) return;
    const el = te.target instanceof Element ? te.target : null;
    tap = {
      target: describe(te.target),
      x: t.clientX,
      y: t.clientY,
      scrollY: window.scrollY,
      vvTop: Math.round(vv?.offsetTop ?? 0),
      vvHeight: Math.round(vv?.height ?? 0),
      startedAt: performance.now(),
      moved: 0,
      sawPointerDown: false,
      sawPointerUp: false,
      sawTouchEnd: false,
      sawCancel: null,
      preventedOn: [],
    };
    const hit = document.elementFromPoint(t.clientX, t.clientY);
    emit('');
    emit(`[tap] ${tap.target} @${Math.round(t.clientX)},${Math.round(t.clientY)}`);
    emit(`  touchAction=${resolvedTouchAction(el)} peNoneAncestor=${blockingAncestor(el) ?? 'none'}`);
    if (hit && hit !== te.target && !hit.contains(te.target as Node)) {
      emit(`  !! elementFromPoint=${describe(hit)} differs from target`);
    }
  });

  on('pointerdown', () => {
    if (tap) tap.sawPointerDown = true;
  });
  on('pointerup', () => {
    if (tap) tap.sawPointerUp = true;
  });
  on('pointercancel', () => {
    if (tap) tap.sawCancel = 'pointercancel';
  });
  on('touchcancel', () => {
    if (tap) tap.sawCancel = (tap.sawCancel ? `${tap.sawCancel}+` : '') + 'touchcancel';
  });

  on('touchmove', (e) => {
    const te = e as TouchEvent;
    const t = te.touches[0];
    if (!tap || !t) return;
    tap.moved = Math.max(tap.moved, Math.hypot(t.clientX - tap.x, t.clientY - tap.y));
    if (te.defaultPrevented && !tap.preventedOn.includes('touchmove')) tap.preventedOn.push('touchmove');
  });

  on('touchend', (e) => {
    if (!tap) return;
    const current = tap;
    current.sawTouchEnd = true;
    if (e.defaultPrevented) current.preventedOn.push('touchend');
    const dwell = Math.round(performance.now() - current.startedAt);
    const scrolled = window.scrollY - current.scrollY;
    const vvShift = Math.round((vv?.offsetTop ?? 0) - current.vvTop);
    const vvGrew = Math.round((vv?.height ?? 0) - current.vvHeight);
    emit(
      `  end ${dwell}ms move=${current.moved.toFixed(1)}px scrollΔ=${scrolled} vvTopΔ=${vvShift} vvHΔ=${vvGrew}`,
    );
    emit(
      `  pd=${current.sawPointerDown ? 'Y' : 'N'} pu=${current.sawPointerUp ? 'Y' : 'N'} cancel=${current.sawCancel ?? 'no'} prevented=${current.preventedOn.join(',') || 'no'}`,
    );
    if (clickTimer) clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {
      if (tap === current) {
        emit('  >> CLICK NOT DISPATCHED');
        tap = null;
      }
    }, CLICK_GRACE_MS);
  });

  on('click', (e) => {
    emit(`  >> CLICK OK on ${describe(e.target)}`);
    if (clickTimer) clearTimeout(clickTimer);
    tap = null;
  });

  vv?.addEventListener('resize', () => emit(`[vv] resize h=${Math.round(vv.height)} top=${Math.round(vv.offsetTop)}`));
  window.addEventListener('scroll', () => emit(`[scroll] y=${Math.round(window.scrollY)}`), { passive: true });
}
