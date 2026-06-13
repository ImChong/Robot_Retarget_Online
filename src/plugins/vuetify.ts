import 'vuetify/styles';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import { aliases, mdi } from 'vuetify/iconsets/mdi-svg';

const THEME_STORAGE_KEY = 'rro-theme';
const stored =
  typeof localStorage !== 'undefined'
    ? (localStorage.getItem(THEME_STORAGE_KEY) as 'dark' | 'light' | null)
    : null;
const initialTheme = stored === 'light' ? 'light' : 'dark';

export default createVuetify({
  components,
  directives,
  icons: {
    defaultSet: 'mdi',
    aliases,
    sets: { mdi },
  },
  theme: {
    defaultTheme: initialTheme,
    themes: {
      dark: {
        dark: true,
        colors: {
          background: '#14161a',
          surface: '#1d2026',
          'surface-light': '#262a31',
          primary: '#4fc3f7',
          secondary: '#9575cd',
          success: '#66bb6a',
          warning: '#ffa726',
          error: '#ef5350',
          info: '#29b6f6',
        },
      },
      light: {
        dark: false,
        colors: {
          background: '#f5f6f8',
          surface: '#ffffff',
          'surface-light': '#eef0f3',
          primary: '#0288d1',
          secondary: '#7e57c2',
          success: '#43a047',
          warning: '#fb8c00',
          error: '#e53935',
          info: '#039be5',
        },
      },
    },
  },
  defaults: {
    VBtn: { density: 'comfortable' },
    VTextField: { density: 'compact', variant: 'outlined', hideDetails: true },
    VSelect: { density: 'compact', variant: 'outlined', hideDetails: true },
    VSlider: { density: 'compact', hideDetails: true },
  },
});
