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
