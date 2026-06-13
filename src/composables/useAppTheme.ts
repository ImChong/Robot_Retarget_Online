import { computed, ref, watch } from 'vue';
import { useTheme } from 'vuetify';

export type AppTheme = 'dark' | 'light';

const STORAGE_KEY = 'rro-theme';
export const THEME_CHANGE_EVENT = 'rro-theme-change';

const stored =
  typeof localStorage !== 'undefined' ? (localStorage.getItem(STORAGE_KEY) as AppTheme | null) : null;
export const appTheme = ref<AppTheme>(stored === 'light' ? 'light' : 'dark');

function syncDocumentBackground(theme: AppTheme) {
  if (typeof document === 'undefined') return;
  document.documentElement.style.background = theme === 'light' ? '#f5f6f8' : '#14161a';
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
