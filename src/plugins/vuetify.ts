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
      // Palette mirrors the Notion-inspired tokens of imchong.github.io
      // (`css/style.css` :root / [data-theme='light']).
      dark: {
        dark: true,
        colors: {
          background: '#191919', // --bg
          surface: '#222222', // --bg-alt
          'surface-light': '#2f2f2f', // --surface
          'surface-bright': '#2f2f2f',
          'surface-variant': '#3d3d3d', // --border
          'on-background': '#e8e8e4', // --text
          'on-surface': '#e8e8e4',
          primary: '#5b9cf6', // --accent
          'on-primary': '#191919', // dark ink reads better on the light-blue accent
          secondary: '#a78bfa',
          'on-secondary': '#191919',
          success: '#5cb885',
          warning: '#e0a33f',
          error: '#e2686a',
          info: '#5b9cf6',
        },
      },
      light: {
        dark: false,
        colors: {
          background: '#f7f6f3', // --bg-alt (page canvas)
          surface: '#ffffff', // --surface
          'surface-light': '#f7f6f3',
          'surface-bright': '#ffffff',
          'surface-variant': '#e8e8e4', // --border
          'on-background': '#37352f', // --text
          'on-surface': '#37352f',
          primary: '#2d74da', // --accent
          secondary: '#6d5bd0',
          success: '#2f855a',
          warning: '#b9761f',
          error: '#c9453f',
          info: '#2d74da',
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
