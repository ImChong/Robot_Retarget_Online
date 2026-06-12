import 'vuetify/styles';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import { aliases, mdi } from 'vuetify/iconsets/mdi-svg';

export default createVuetify({
  components,
  directives,
  icons: {
    defaultSet: 'mdi',
    aliases,
    sets: { mdi },
  },
  theme: {
    defaultTheme: 'dark',
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
    },
  },
  defaults: {
    VBtn: { density: 'comfortable' },
    VTextField: { density: 'compact', variant: 'outlined', hideDetails: true },
    VSelect: { density: 'compact', variant: 'outlined', hideDetails: true },
    VSlider: { density: 'compact', hideDetails: true },
  },
});
