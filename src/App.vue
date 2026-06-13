<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDisplay } from 'vuetify';
import { useI18n } from '@/i18n';
import { useAppTheme } from '@/composables/useAppTheme';
import { mdiTranslate, mdiGithub, mdiWeatherSunny, mdiWeatherNight, mdiHeart } from '@mdi/js';

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

// Sponsor popup — QR lives in public/ so it's served under the deploy base path.
const sponsorOpen = ref(false);
const sponsorQrSrc = `${import.meta.env.BASE_URL}sponsor/wechat-pay.png`;

// re-render tab labels on locale change
void locale.value;
</script>

<template>
  <v-app>
    <v-app-bar density="comfortable" flat border class="app-bar">
      <v-app-bar-title class="app-title">
        <span class="app-logo mr-2" aria-hidden="true">🔄</span>
        <span class="font-weight-bold d-none d-sm-inline">{{ t('appTitleBilingual') }}</span>
        <span class="text-medium-emphasis ml-2 d-none d-lg-inline" style="font-size: 0.8em">
          GMR
        </span>
      </v-app-bar-title>

      <v-tabs v-if="mdAndUp" v-model="currentTab" color="primary" class="app-bar-tabs">
        <v-tab v-for="tab in tabs" :key="tab.value" :value="tab.value">{{ tab.label }}</v-tab>
      </v-tabs>

      <v-spacer v-if="!mdAndUp" />

      <div class="app-bar-actions">
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
          variant="text"
          class="sponsor-btn"
          :prepend-icon="mdiHeart"
          :aria-label="t('sponsorTitle')"
          :title="t('sponsorTitle')"
          @click="sponsorOpen = true"
        >
          <span class="d-none d-sm-inline">{{ t('sponsor') }}</span>
        </v-btn>
        <v-btn
          :icon="mdiGithub"
          variant="text"
          href="https://github.com/ImChong/Robot_Retarget_Online"
          target="_blank"
          rel="noopener"
        />
      </div>
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

    <v-dialog v-model="sponsorOpen" max-width="340">
      <v-card rounded="xl" class="sponsor-card">
        <v-card-item class="text-center pt-5 pb-1">
          <div class="text-h6 font-weight-bold">{{ t('sponsorTitle') }}</div>
          <div class="text-medium-emphasis text-body-2 mt-1">{{ t('sponsorHint') }}</div>
        </v-card-item>
        <v-card-text class="d-flex justify-center pb-2">
          <img :src="sponsorQrSrc" :alt="t('sponsorImgAlt')" class="sponsor-qr" />
        </v-card-text>
        <v-card-actions class="justify-center pb-4">
          <v-btn variant="tonal" @click="sponsorOpen = false">{{ t('close') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-app>
</template>

<style>
:root {
  --app-bar-height: 64px;
  --app-bar-outer-height: calc(56px + 2px); /* comfortable toolbar + top/bottom border */
  --app-bar-icon-size: 36px;
  --app-bar-edge-inset: calc((var(--app-bar-outer-height) - var(--app-bar-icon-size)) / 2);
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

.app-logo {
  font-size: 1.35rem;
  line-height: 1;
  vertical-align: middle;
}

.app-bar-actions {
  display: flex;
  align-items: center;
  padding-right: var(--app-bar-edge-inset);
}

@media (min-width: 960px) {
  .app-bar :deep(.v-toolbar__content) {
    position: relative;
  }

  .app-bar-tabs {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 1;
  }

  .app-bar-actions {
    margin-left: auto;
  }
}

.bottom-nav {
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

.locale-btn {
  min-width: 0 !important;
}

.sponsor-btn {
  min-width: 0 !important;
}

/* Tint just the heart so the sponsor action stands out without recoloring the label. */
.sponsor-btn :deep(.v-icon) {
  color: #e2566a;
}

.sponsor-qr {
  display: block;
  width: 100%;
  max-width: 260px;
  height: auto;
  border-radius: 12px;
}
</style>
