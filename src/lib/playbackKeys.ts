/** Elements where playback shortcuts must not override native keyboard behavior. */
export function shouldIgnorePlaybackKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return true;
  if (
    target.closest(
      'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="option"]',
    )
  ) {
    return true;
  }
  return !!document.querySelector('.v-overlay--active');
}

export function isPlaybackKeyCode(code: string): boolean {
  return code === 'Space' || code === 'ArrowLeft' || code === 'ArrowRight';
}

/** Block native behavior (tab activation, page scroll) for handled playback keys. */
export function suppressPlaybackKeyEvent(e: Pick<KeyboardEvent, 'preventDefault' | 'stopPropagation'>): void {
  e.preventDefault();
  e.stopPropagation();
}

/** Suppress keyup defaults for handled playback keys (Space click synthesis, arrow scroll). */
export function shouldSuppressPlaybackKeyUp(code: string): boolean {
  return code === 'Space' || code === 'ArrowLeft' || code === 'ArrowRight';
}
