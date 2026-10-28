import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import vuetify from './plugins/vuetify';
// After Vuetify's stylesheet so the design tokens and overrides win ties.
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles/design.css';
import { installTapFallback } from './lib/tapFallback';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(vuetify);
app.mount('#app');

// Disables itself on any browser that dispatches click normally.
installTapFallback();
// Diagnostics overlay, fetched only when the URL contains `touchdebug`; see
// src/lib/touchDebug.ts (index.html arms the event probe before this runs).
if (location.href.includes('touchdebug')) {
  void import('./lib/touchDebug').then((m) => m.installTouchDebug());
}
