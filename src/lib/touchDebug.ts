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

const MAX_LINES = 18;
/** A synthesised click follows touchend closely; past this it is not coming. */
const CLICK_GRACE_MS = 500;

interface PreventedCall {
  type: string;
  stack: string;
}
interface GlobalListener {
  type: string;
  on: string;
  capture: boolean;
  passive: boolean;
  stack: string;
}
/** Populated by the early probe in index.html, before any bundle runs. */
interface TouchProbe {
  prevented: PreventedCall[];
  listeners: GlobalListener[];
}

function probeData(): TouchProbe | null {
  return (window as unknown as { __touchProbe?: TouchProbe }).__touchProbe ?? null;
}

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

/**
 * Ancestors forced onto their own GPU layer. Promotion is the leading suspect
 * for iOS dropping click synthesis, so name every one on the chain.
 */
function compositedAncestors(el: Element | null): string[] {
  const found: string[] = [];
  let node: Element | null = el;
  while (node) {
    const cs = getComputedStyle(node);
    const why: string[] = [];
    if (cs.transform && cs.transform !== 'none') why.push('transform');
    const backdrop = cs.backdropFilter || (cs as unknown as Record<string, string>).webkitBackdropFilter;
    if (backdrop && backdrop !== 'none') why.push('backdrop-filter');
    if (cs.filter && cs.filter !== 'none') why.push('filter');
    if (cs.willChange && cs.willChange !== 'auto') why.push(`will-change:${cs.willChange}`);
    if (why.length) found.push(`${describe(node)}[${why.join('+')}]`);
    node = node.parentElement;
  }
  return found;
}

/** The element that would actually receive the activation, and its state. */
function activationTarget(el: Element | null): string {
  const control = el?.closest('button,a,[role="button"],input,select');
  if (!control) return 'none';
  const disabled = control.hasAttribute('disabled') || control.getAttribute('aria-disabled') === 'true';
  return `${describe(control)} disabled=${disabled}`;
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
  /** Pinned above the log so it survives scroll-off; the first capture lost it. */
  let header = '';
  function render() {
    panel.textContent = `${header}\n${lines.join('\n')}`;
  }
  function emit(line: string) {
    lines.push(line);
    if (lines.length > MAX_LINES) lines.shift();
    render();
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
  function refreshHeader() {
    const ta = document.documentElement.style.touchAction || getComputedStyle(document.documentElement).touchAction;
    header = `[env] ${env()}\n[html] touch-action=${ta} | ${navigator.userAgent.slice(0, 60)}`;
    render();
  }
  refreshHeader();
  emit('[ready] tap CTRL, then a dead app button');

  /*
   * Debug controls activate on touchend, never on click — the whole point is
   * that click may be broken, so they must not depend on it.
   */
  let slot = 0;
  function debugButton(label: string, onTap: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = [
      'position:fixed',
      `right:${8 + slot++ * 72}px`,
      'top:calc(28% - 40px)',
      'z-index:2147483647',
      'pointer-events:auto',
      'min-width:64px',
      'min-height:36px',
      'font:12px/1 ui-monospace,monospace',
      'color:#000',
      'background:#8ef',
      'border:2px solid #fff',
      'border-radius:8px',
    ].join(';');
    b.addEventListener('touchend', (e) => {
      e.stopPropagation();
      onTap();
    });
    document.body.appendChild(b);
    return b;
  }

  /*
   * Control experiment: a bare <button> outside the app's markup, styling and
   * stacking. Its click listener is the measurement — if CTRL clicks while app
   * buttons do not, the cause is in the app; if CTRL is dead too, it is
   * document- or browser-wide.
   */
  let controlClicks = 0;
  const control = debugButton('CTRL', () => emit('[ctrl] touchend seen'));
  control.addEventListener('click', () => emit(`[ctrl] CLICK OK (${++controlClicks})`));

  // Does the click come back if the root stops declaring touch-action?
  debugButton('TA', () => {
    const doc = document.documentElement;
    doc.style.touchAction = doc.style.touchAction === 'auto' ? 'manipulation' : 'auto';
    refreshHeader();
    emit(`[ta] html touch-action -> ${doc.style.touchAction}`);
  });

  // Every touch/pointer/click listener bound to window, document or body — minus
  // this file's own, which would otherwise crowd out the ones that matter.
  debugButton('LIST', () => {
    const all = probeData()?.listeners ?? [];
    const others = all.filter((l) => !l.stack.includes('touchDebug'));
    emit(`[listeners] ${others.length} global (of ${all.length})`);
    for (const l of others.slice(0, 6)) {
      emit(`  ${l.on}.${l.type} cap=${l.capture ? 'Y' : 'N'} pas=${l.passive ? 'Y' : 'N'}`);
      emit(`   ${l.stack.slice(0, 90)}`);
    }
  });

  let tap: TapRecord | null = null;
  let clickTimer: ReturnType<typeof setTimeout> | null = null;
  /** WebKit fires pointerdown *before* touchstart, so stash it until the record exists. */
  let pendingPointerDown: { seen: boolean; prevented: boolean } = { seen: false, prevented: false };

  const on = (type: string, fn: (e: Event) => void) =>
    document.addEventListener(type, fn, { capture: true, passive: true });

  /**
   * How many preventDefault calls the early probe had logged when this tap
   * started. Reading `defaultPrevented` from a capture listener is useless — it
   * runs before every bubble-phase handler, so it always reads false.
   */
  let preventedMark = 0;

  /** preventDefault calls on touch/pointer/click since the tap began, with callers. */
  function reportPrevented() {
    const probe = probeData();
    if (!probe) return;
    const fresh = probe.prevented.slice(preventedMark);
    preventedMark = probe.prevented.length;
    if (!fresh.length) {
      emit('  preventDefault: none during this tap');
      return;
    }
    const byType = new Map<string, string>();
    for (const p of fresh) if (!byType.has(p.type)) byType.set(p.type, p.stack);
    emit(`  preventDefault: ${[...byType.keys()].join(',')}`);
    for (const [type, stack] of byType) emit(`   ${type} <- ${stack.slice(0, 100)}`);
  }

  /** Report a pending tap before it is replaced, so rapid taps each get a verdict. */
  function flushPending() {
    if (clickTimer) clearTimeout(clickTimer);
    clickTimer = null;
    if (tap && tap.sawTouchEnd) {
      reportPrevented();
      emit('  >> CLICK NOT DISPATCHED');
    }
    tap = null;
  }

  on('touchstart', (e) => {
    const te = e as TouchEvent;
    const t = te.touches[0];
    if (!t) return;
    flushPending();
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
      sawPointerDown: pendingPointerDown.seen,
      sawPointerUp: false,
      sawCancel: null,
      sawTouchEnd: false,
      preventedOn: pendingPointerDown.prevented ? ['pointerdown'] : [],
    };
    pendingPointerDown = { seen: false, prevented: false };
    preventedMark = probeData()?.prevented.length ?? 0;
    const hit = document.elementFromPoint(t.clientX, t.clientY);
    const composited = compositedAncestors(el);
    emit('');
    emit(`[tap] ${tap.target} @${Math.round(t.clientX)},${Math.round(t.clientY)}`);
    emit(`  control=${activationTarget(el)}`);
    emit(`  touchAction=${resolvedTouchAction(el)} peNone=${blockingAncestor(el) ?? 'none'}`);
    emit(`  gpuLayers=${composited.length ? composited.slice(0, 3).join(' < ') : 'none'}`);
    if (hit && hit !== te.target && !hit.contains(te.target as Node)) {
      emit(`  !! elementFromPoint=${describe(hit)} differs from target`);
    }
  });

  on('pointerdown', (e) => {
    if (tap) {
      tap.sawPointerDown = true;
      if (e.defaultPrevented) tap.preventedOn.push('pointerdown');
    } else {
      pendingPointerDown = { seen: true, prevented: e.defaultPrevented };
    }
  });
  on('pointerup', (e) => {
    if (!tap) return;
    tap.sawPointerUp = true;
    if (e.defaultPrevented) tap.preventedOn.push('pointerup');
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
      `  pd=${current.sawPointerDown ? 'Y' : 'N'} pu=${current.sawPointerUp ? 'Y' : 'N'} cancel=${current.sawCancel ?? 'no'}`,
    );
    if (clickTimer) clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {
      if (tap === current) {
        reportPrevented();
        emit('  >> CLICK NOT DISPATCHED');
        tap = null;
      }
    }, CLICK_GRACE_MS);
  });

  on('click', (e) => {
    reportPrevented();
    emit(`  >> CLICK OK on ${describe(e.target)}`);
    if (clickTimer) clearTimeout(clickTimer);
    tap = null;
  });

  vv?.addEventListener('resize', () => emit(`[vv] resize h=${Math.round(vv.height)} top=${Math.round(vv.offsetTop)}`));
  window.addEventListener('scroll', () => emit(`[scroll] y=${Math.round(window.scrollY)}`), { passive: true });
}
