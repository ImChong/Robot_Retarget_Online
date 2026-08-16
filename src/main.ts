import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import vuetify from './plugins/vuetify';
import { installTouchDebug } from './lib/touchDebug';
import { installTapFallback } from './lib/tapFallback';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(vuetify);
app.mount('#app');

// Disables itself on any browser that dispatches click normally.
installTapFallback();
// No-op unless the URL contains `touchdebug`; see src/lib/touchDebug.ts.
installTouchDebug();
