<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from '@/i18n';
import { mdiTranslate, mdiGithub, mdiRobotExcited } from '@mdi/js';

const { t, toggleLocale, localeLabel, locale } = useI18n();
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
        <span class="font-weight-bold">{{ t('appTitle') }}</span>
        <span class="text-medium-emphasis ml-2 d-none d-md-inline" style="font-size: 0.8em">
          GMR · Unitree G1 / Booster T1
        </span>
      </v-app-bar-title>

      <v-tabs v-model="currentTab" color="primary" class="d-none d-sm-flex">
        <v-tab v-for="tab in tabs" :key="tab.value" :value="tab.value">{{ tab.label }}</v-tab>
      </v-tabs>

      <v-spacer />

      <v-btn variant="text" :prepend-icon="mdiTranslate" @click="toggleLocale">
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

    <!-- Mobile nav -->
    <v-bottom-navigation v-if="$vuetify.display.xs" v-model="currentTab" grow color="primary">
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
html {
  overflow-y: hidden !important;
}
.app-main {
  height: 100vh;
}
.app-title {
  flex: 0 0 auto;
  min-width: 0;
}
</style>
