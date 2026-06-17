<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDisplay } from 'vuetify';
import { useI18n } from '@/i18n';
import { useAppTheme } from '@/composables/useAppTheme';
import { mdiTranslate, mdiGithub, mdiWeatherSunny, mdiWeatherNight, mdiCoffee } from '@mdi/js';
import SponsorDialog from '@/components/SponsorDialog.vue';

const { t, toggleLocale, localeLabel, locale } = useI18n();
const { isDark, toggleAppTheme } = useAppTheme();
const { mdAndUp } = useDisplay();
const route = useRoute();
const router = useRouter();

const tabs = computed(() => [
  { value: 'bvh', label: t('navBvh'), step: 1 },
  { value: 'config', label: t('navConfig'), step: 2 },
  { value: 'preview', label: t('navPreview'), step: 3 },
]);

const currentTab = computed({
  get: () => (route.name as string) ?? 'bvh',
  set: (v: string) => {
    router.push({ name: v });
  },
});

const sponsorOpen = ref(false);

// re-render tab labels on locale change
void locale.value;
</script>

<template>
  <v-app>
    <v-app-bar density="comfortable" flat border class="app-bar">
      <div class="app-bar-inner">
        <div class="app-bar-brand" :aria-label="t('appTitleBilingual')">
          <span class="app-title-text font-weight-bold">{{ t('appTitleBilingual') }}</span>
        </div>

        <v-tabs v-if="mdAndUp" v-model="currentTab" color="primary" class="app-bar-tabs">
          <v-tab v-for="tab in tabs" :key="tab.value" :value="tab.value">
            <span class="tab-with-step">
              <span class="tab-step" aria-hidden="true">{{ tab.step }}</span>
              <span class="tab-label">{{ tab.label }}</span>
            </span>
          </v-tab>
        </v-tabs>

        <div class="app-bar-actions">
          <v-btn
            :icon="isDark ? mdiWeatherSunny : mdiWeatherNight"
            variant="text"
            :aria-label="isDark ? t('themeDark') : t('themeLight')"
            :title="isDark ? t('themeDark') : t('themeLight')"
            @click="toggleAppTheme"
          />
          <v-btn
            v-if="mdAndUp"
            variant="text"
            :prepend-icon="mdiTranslate"
            class="locale-btn"
            :aria-label="localeLabel"
            :title="localeLabel"
            @click="toggleLocale"
          >
            {{ localeLabel }}
          </v-btn>
          <v-btn
            v-else
            variant="text"
            :icon="mdiTranslate"
            class="locale-btn"
            :aria-label="localeLabel"
            :title="localeLabel"
            @click="toggleLocale"
          />
          <v-btn
            :icon="mdiCoffee"
            variant="text"
            class="sponsor-btn"
            :aria-label="t('sponsorTitle')"
            :title="t('sponsorTitle')"
            @click="sponsorOpen = true"
          />
          <v-btn
            :icon="mdiGithub"
            variant="text"
            href="https://github.com/ImChong/Robot_Retarget_Online"
            target="_blank"
            rel="noopener"
          />
        </div>
      </div>
    </v-app-bar>

    <v-bottom-navigation v-if="!mdAndUp" v-model="currentTab" grow color="primary" class="bottom-nav">
      <v-btn v-for="tab in tabs" :key="tab.value" :value="tab.value">
        <span class="tab-with-step tab-with-step--compact">
          <span class="tab-step" aria-hidden="true">{{ tab.step }}</span>
          <span class="tab-label">{{ tab.label }}</span>
        </span>
      </v-btn>
    </v-bottom-navigation>

    <v-main class="app-main">
      <router-view v-slot="{ Component }">
        <keep-alive>
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </v-main>

    <SponsorDialog v-model="sponsorOpen" />
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

.app-bar :deep(.v-toolbar__content) {
  width: 100%;
  padding-inline: 16px;
}

.app-bar-inner {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
}

.app-bar-brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  padding-left: var(--app-bar-edge-inset);
}

.app-title-text {
  line-height: 1.2;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-bar-actions {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  flex-shrink: 0;
}

@media (max-width: 768px) {
  .app-title-text {
    font-size: 0.94rem;
    white-space: normal;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .app-bar-actions {
    gap: 0;
    padding-right: 2px;
  }
}

@media (min-width: 960px) {
  .app-bar :deep(.v-toolbar__content) {
    padding-inline: 16px;
  }

  .app-bar-inner {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    column-gap: 16px;
    align-items: center;
  }

  .app-bar-brand {
    justify-self: start;
    flex: initial;
  }

  .app-bar-tabs {
    justify-self: center;
    flex-shrink: 0;
  }

  .app-bar-actions {
    justify-self: end;
    padding-right: var(--app-bar-edge-inset);
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

.sponsor-btn :deep(.v-icon) {
  color: #e2566a;
}

.tab-with-step {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.tab-with-step--compact {
  flex-direction: column;
  gap: 2px;
}

.tab-step {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  flex-shrink: 0;
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.55);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  transition: background-color 0.2s, color 0.2s, border-color 0.2s;
}

.tab-label {
  line-height: 1.2;
}

.app-bar-tabs :deep(.v-tab--selected) .tab-step,
.bottom-nav :deep(.v-btn--selected) .tab-step {
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  border-color: transparent;
}

</style>
