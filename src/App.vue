<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDisplay } from 'vuetify';
import { useI18n } from '@/i18n';
import { useAppTheme } from '@/composables/useAppTheme';
import { mdiTranslate, mdiGithub, mdiRobotExcited, mdiWeatherSunny, mdiWeatherNight } from '@mdi/js';

const { t, toggleLocale, localeLabel, locale } = useI18n();
const { isDark, toggleAppTheme } = useAppTheme();
const { mdAndUp } = useDisplay();
const route = useRoute();
const router = useRouter();

const tabs = computed(() => [
  { value: 'bvh', label: t('navBvh') },
  { value: 'config', label: t('navConfig') },
  { value: 'preview', label: t('navPreview') },
]);

const currentTab = computed({
  get: () => (route.name as string) ?? 'bvh',
  set: (v: string) => {
    router.push({ name: v });
  },
});

// re-render tab labels on locale change
void locale.value;
</script>

<template>
  <v-app>
    <v-app-bar density="comfortable" flat border>
      <v-app-bar-title class="app-title">
        <v-icon :icon="mdiRobotExcited" color="primary" class="mr-2" />
        <span class="font-weight-bold d-none d-sm-inline">{{ t('appTitle') }}</span>
        <span class="text-medium-emphasis ml-2 d-none d-lg-inline" style="font-size: 0.8em">
          GMR · Unitree G1 / Booster T1
        </span>
      </v-app-bar-title>

      <v-tabs v-if="mdAndUp" v-model="currentTab" color="primary">
        <v-tab v-for="tab in tabs" :key="tab.value" :value="tab.value">{{ tab.label }}</v-tab>
      </v-tabs>

      <v-spacer />

      <v-btn
        :icon="isDark ? mdiWeatherSunny : mdiWeatherNight"
        variant="text"
        :aria-label="isDark ? t('themeDark') : t('themeLight')"
        :title="isDark ? t('themeDark') : t('themeLight')"
        @click="toggleAppTheme"
      />
      <v-btn variant="text" :prepend-icon="mdiTranslate" class="locale-btn" @click="toggleLocale">
        {{ localeLabel }}
      </v-btn>
      <v-btn
        :icon="mdiGithub"
        variant="text"
        href="https://github.com/ImChong/Robot_Retarget_Online"
        target="_blank"
        rel="noopener"
      />
    </v-app-bar>

    <v-bottom-navigation v-if="!mdAndUp" v-model="currentTab" grow color="primary" class="bottom-nav">
      <v-btn v-for="tab in tabs" :key="tab.value" :value="tab.value">{{ tab.label }}</v-btn>
    </v-bottom-navigation>

    <v-main class="app-main">
      <router-view v-slot="{ Component }">
        <keep-alive>
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </v-main>
  </v-app>
</template>

<style>
:root {
  --app-bar-height: 64px;
  --app-bottom-nav-height: 0px;
}

@media (max-width: 959.98px) {
  :root {
    --app-bottom-nav-height: 56px;
  }

  html {
    overflow-y: auto !important;
  }
}

@media (min-width: 960px) {
  html {
    overflow-y: hidden !important;
  }
}

.app-main {
  height: calc(100dvh - var(--app-bar-height) - var(--app-bottom-nav-height));
  overflow: hidden;
}

.app-title {
  flex: 0 0 auto;
  min-width: 0;
}

.bottom-nav {
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

.locale-btn {
  min-width: 0 !important;
}
</style>
