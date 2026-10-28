import { computed, ref, watch } from 'vue';
import { useTheme } from 'vuetify';

export type AppTheme = 'dark' | 'light';

const STORAGE_KEY = 'rro-theme';
export const THEME_CHANGE_EVENT = 'rro-theme-change';

function readStoredTheme(): AppTheme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

const lightQuery =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: light)')
    : null;

function systemTheme(): AppTheme {
  return lightQuery?.matches ? 'light' : 'dark';
}

/**
 * The theme to start in: an explicit choice saved by the header toggle wins,
 * otherwise follow the OS. Keep in sync with the pre-paint script in index.html.
 */
export function resolveInitialTheme(): AppTheme {
  return readStoredTheme() ?? systemTheme();
}

export const appTheme = ref<AppTheme>(resolveInitialTheme());

// Track the OS setting live until the user picks a theme themselves.
lightQuery?.addEventListener?.('change', () => {
  if (readStoredTheme() === null) appTheme.value = systemTheme();
});

/** Page backgrounds — mirrors the Vuetify theme `background` colors (and the pre-paint script in index.html). */
const PAGE_BACKGROUND: Record<AppTheme, string> = {
  dark: '#181818',
  light: '#f7f6f3',
};

function syncDocumentBackground(theme: AppTheme) {
  if (typeof document === 'undefined') return;
  document.documentElement.style.background = PAGE_BACKGROUND[theme];
  document.documentElement.dataset.theme = theme;
}

function notifyThemeChange(theme: AppTheme) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(THEME_CHANGE_EVENT, { detail: { theme, dark: theme === 'dark' } }),
  );
}

export function setAppTheme(theme: AppTheme) {
  appTheme.value = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
}

export function toggleAppTheme() {
  setAppTheme(appTheme.value === 'dark' ? 'light' : 'dark');
}

/** Reactive theme helper — call inside setup() so Vuetify's useTheme is available. */
export function useAppTheme() {
  const vuetifyTheme = useTheme();

  watch(
    appTheme,
    (theme) => {
      vuetifyTheme.global.name.value = theme;
      syncDocumentBackground(theme);
      notifyThemeChange(theme);
    },
    { immediate: true },
  );

  return {
    appTheme,
    isDark: computed(() => appTheme.value === 'dark'),
    setAppTheme,
    toggleAppTheme,
  };
}
