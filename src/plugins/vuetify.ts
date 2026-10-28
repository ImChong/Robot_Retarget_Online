import 'vuetify/styles';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import { mdi } from 'vuetify/iconsets/mdi-svg';
import { resolveInitialTheme } from '@/composables/useAppTheme';
import { vuetifyAliases } from '@/lib/icons';

export default createVuetify({
  components,
  directives,
  icons: {
    defaultSet: 'mdi',
    aliases: vuetifyAliases,
    sets: { mdi },
  },
  theme: {
    defaultTheme: resolveInitialTheme(),
    themes: {
      // Notion-style neutrals from imchong.github.io, with the dark surfaces
      // snapped to the redesign palette (#181818 / #1F1F1F / #272727 / #313131)
      // and a single accent kept under 80% saturation. Mirrored as CSS tokens
      // in src/styles/design.css.
      dark: {
        dark: true,
        colors: {
          background: '#181818',
          surface: '#1f1f1f',
          'surface-light': '#272727',
          'surface-bright': '#313131',
          'surface-variant': '#3d3d3d', // --rro-border; also the tooltip fill
          'on-background': '#e8e8e4',
          'on-surface': '#e8e8e4',
          primary: '#669eea',
          'on-primary': '#181818', // dark ink reads better on the light-blue accent
          // No second accent: secondary is a neutral so nothing renders purple.
          secondary: '#9b9a97',
          'on-secondary': '#181818',
          success: '#5cb885',
          warning: '#e0a33f',
          error: '#e2686a',
          info: '#669eea',
        },
      },
      light: {
        dark: false,
        colors: {
          background: '#f7f6f3',
          surface: '#ffffff',
          'surface-light': '#f7f6f3',
          'surface-bright': '#ffffff',
          'surface-variant': '#e8e8e4',
          'on-background': '#37352f',
          'on-surface': '#37352f',
          primary: '#2d74da',
          secondary: '#787774',
          success: '#2f855a',
          warning: '#b9761f',
          error: '#c9453f',
          info: '#2d74da',
        },
      },
    },
  },
  defaults: {
    VBtn: { density: 'comfortable', rounded: 'lg' },
    VBtnToggle: { rounded: 'lg' },
    VTextField: { density: 'compact', variant: 'outlined', hideDetails: true, rounded: 'lg' },
    VSelect: { density: 'compact', variant: 'outlined', hideDetails: true, rounded: 'lg' },
    VSlider: { density: 'compact', hideDetails: true },
    // Tabs keep square corners so their underline slider isn't clipped.
    VTab: { rounded: 0 },
  },
});
