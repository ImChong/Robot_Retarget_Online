<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDisplay } from 'vuetify';
import { useI18n } from '@/i18n';
import { useAppTheme } from '@/composables/useAppTheme';
import { useMotionStore } from '@/stores/motion';
import { useRetargetStore } from '@/stores/retarget';
import { mdiWeatherSunny, mdiWeatherNight, mdiCoffee } from '@mdi/js';
import SponsorDialog from '@/components/SponsorDialog.vue';

const { t, toggleLocale, localeLabel, locale } = useI18n();
const { isDark, toggleAppTheme } = useAppTheme();
const { mdAndUp } = useDisplay();
const route = useRoute();
const router = useRouter();
const motion = useMotionStore();
const retarget = useRetargetStore();

const tabs = computed(() => [
  { value: 'bvh', label: t('navBvh'), step: 1, disabled: false, disabledHint: '' },
  {
    value: 'config',
    label: t('navConfig'),
    step: 2,
    disabled: !motion.hasMotion,
    disabledHint: t('navConfigDisabledHint'),
  },
  {
    value: 'preview',
    label: t('navPreview'),
    step: 3,
    disabled: !retarget.hasHistory,
    disabledHint: t('navPreviewDisabledHint'),
  },
]);

const currentTab = computed({
  get: () => (route.name as string) ?? 'bvh',
  set: (v: string) => {
    const tab = tabs.value.find((item) => item.value === v);
    if (tab?.disabled) return;
    router.push({ name: v });
  },
});

const sponsorOpen = ref(false);

// re-render tab labels on locale change
void locale.value;
</script>

<template>
  <v-app>
    <v-app-bar :height="56" flat class="site-header">
      <div class="header-inner">
        <router-link :to="{ name: 'bvh' }" class="site-title" :aria-label="t('appTitleBilingual')">
          <span class="site-title-icon" aria-hidden="true">🔄</span>
          <span class="site-title-text">{{ t('appTitleBilingual') }}</span>
        </router-link>

        <v-tabs v-if="mdAndUp" v-model="currentTab" color="primary" class="header-nav">
          <v-tab v-for="tab in tabs" :key="tab.value" :value="tab.value" :disabled="tab.disabled">
            <v-tooltip v-if="tab.disabled && tab.disabledHint" :text="tab.disabledHint" location="bottom">
              <template #activator="{ props: tipProps }">
                <span v-bind="tipProps" class="tab-tooltip-wrap">
                  <span class="tab-with-step">
                    <span class="tab-step" aria-hidden="true">{{ tab.step }}</span>
                    <span class="tab-label">{{ tab.label }}</span>
                  </span>
                </span>
              </template>
            </v-tooltip>
            <span v-else class="tab-with-step">
              <span class="tab-step" aria-hidden="true">{{ tab.step }}</span>
              <span class="tab-label">{{ tab.label }}</span>
            </span>
          </v-tab>
        </v-tabs>

        <div class="header-right">
          <a
            class="github-link"
            href="https://github.com/ImChong/Robot_Retarget_Online"
            target="_blank"
            rel="noopener noreferrer"
            :aria-label="t('viewOnGithub')"
            :title="t('viewOnGithub')"
          >
            <span class="github-link-text">GitHub</span>
          </a>
          <button
            type="button"
            class="header-btn lang-toggle"
            :aria-label="t('switchLanguage')"
            :title="t('switchLanguage')"
            @click="toggleLocale"
          >
            {{ localeLabel }}
          </button>
          <button
            type="button"
            class="header-btn theme-toggle"
            :aria-label="isDark ? t('themeDark') : t('themeLight')"
            :title="isDark ? t('themeDark') : t('themeLight')"
            @click="toggleAppTheme"
          >
            <v-icon :icon="isDark ? mdiWeatherSunny : mdiWeatherNight" size="17" />
          </button>
          <button
            type="button"
            class="header-btn sponsor-toggle"
            :aria-label="t('sponsorTitle')"
            :title="t('sponsorTitle')"
            aria-haspopup="dialog"
            @click="sponsorOpen = true"
          >
            <v-icon :icon="mdiCoffee" size="17" />
          </button>
        </div>
      </div>
    </v-app-bar>

    <v-bottom-navigation v-if="!mdAndUp" v-model="currentTab" grow color="primary" class="bottom-nav">
      <v-btn v-for="tab in tabs" :key="tab.value" :value="tab.value" :disabled="tab.disabled">
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
/*
 * Site palette — mirrors the Notion-inspired tokens of imchong.github.io
 * (`css/style.css`); `data-theme` is set on <html> by useAppTheme.
 * Header chrome follows Humanoid_Robot_Learning_Paper_Notebooks'
 * `.site-header` (bold sans title, GitHub text link, 36×30 pill toggles).
 */
:root {
  --rro-header-bg: #222222;
  --rro-border: #3d3d3d;
  --rro-text: #e8e8e4;
  --rro-text-muted: #9b9a97;
  --rro-accent: #5b9cf6;
  --rro-accent-hover: #7ab3ff;
  --rro-hover-bg: #2f2f2f;
  --rro-sponsor: #e2566a;
  --rro-radius: 6px;
  --rro-font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial,
    'Noto Sans SC', sans-serif;

  --app-bar-height: 56px;
  --app-bottom-nav-height: 0px;
  /* Apple HIG minimum hit area; see the "Touch input" block at the end. */
  --rro-tap-target: 44px;
}

:root[data-theme='light'] {
  --rro-header-bg: #ffffff;
  --rro-border: #e8e8e4;
  --rro-text: #37352f;
  --rro-text-muted: #787774;
  --rro-accent: #2d74da;
  --rro-accent-hover: #1a5bb8;
  --rro-hover-bg: #f7f6f3;
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

/*
 * Header rules are scoped under `.site-header` (and paired with `.v-toolbar` /
 * `.v-btn` where needed) so they outrank Vuetify's same-specificity resets,
 * which are injected after this block — e.g. `[type='button'] { color: inherit }`.
 */
.site-header.v-toolbar {
  background: var(--rro-header-bg);
  border-bottom: 1px solid var(--rro-border);
  /* No backdrop-filter: --rro-header-bg is fully opaque, so it blurred nothing
     visible and only cost a compositing layer. See the "Touch input" block. */
}

.site-header .v-toolbar__content {
  width: 100%;
  padding-inline: 0;
}

.header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
  min-width: 0;
  height: 100%;
  padding-inline: 24px;
}

.site-title {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
  font-family: var(--rro-font-sans);
  font-size: 1.05rem;
  font-weight: 700;
  line-height: 1.25;
  color: var(--rro-text);
  text-decoration: none;
  transition: color 0.2s ease;
}

.site-title:hover {
  color: var(--rro-accent);
}

.site-title-icon {
  flex-shrink: 0;
  font-size: 1rem;
}

.site-title-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  flex: 0 0 auto;
}

.site-header .github-link {
  display: inline-flex;
  align-items: center;
  height: 30px;
  font-family: var(--rro-font-sans);
  font-size: 0.85rem;
  color: var(--rro-text-muted);
  text-decoration: none;
  transition: color 0.2s ease;
}

.site-header .github-link:hover {
  color: var(--rro-accent);
}

.site-header .header-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  min-width: 36px;
  height: 30px;
  padding: 0 0.6rem;
  background: none;
  border: 1px solid var(--rro-border);
  border-radius: var(--rro-radius);
  color: var(--rro-text-muted);
  font-family: var(--rro-font-sans);
  font-size: 0.78rem;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  user-select: none;
  transition: color 0.2s ease, background 0.2s ease, border-color 0.2s ease;
}

.site-header .header-btn:hover {
  border-color: var(--rro-accent);
  color: var(--rro-text);
}

.site-header .header-btn:focus-visible {
  outline: 2px solid var(--rro-accent);
  outline-offset: 2px;
}

.site-header .lang-toggle:hover {
  background: var(--rro-accent);
  border-color: var(--rro-accent);
  color: #fff;
}

.site-header .sponsor-toggle {
  color: var(--rro-sponsor);
}

.site-header .sponsor-toggle:hover {
  border-color: var(--rro-sponsor);
  background: rgba(226, 86, 106, 0.12);
  color: var(--rro-sponsor);
}

/* ===== Header nav (workflow steps) ===== */
.header-nav {
  flex-shrink: 0;
}

.header-nav .v-tab.v-btn {
  min-width: 0;
  padding-inline: 14px;
  font-family: var(--rro-font-sans);
  font-size: 0.82rem;
  font-weight: 600;
  letter-spacing: 0;
  text-transform: none;
  color: var(--rro-text-muted);
}

.header-nav .v-tab.v-btn:hover {
  color: var(--rro-text);
}

.header-nav .v-tab.v-btn--disabled {
  color: var(--rro-text-muted);
}

.header-nav .v-tab.v-tab--selected {
  color: var(--rro-accent);
}

@media (max-width: 959.98px) {
  .header-inner {
    gap: 0.5rem;
    padding-inline: 12px;
  }

  .site-title {
    flex: 1 1 0;
    font-size: 0.96rem;
  }

  .header-right {
    gap: 0.35rem;
  }

  .site-header .github-link {
    font-size: 0.78rem;
  }

  .site-header .header-btn {
    min-width: 32px;
    padding: 0 0.45rem;
  }
}

@media (min-width: 960px) {
  .header-inner {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    column-gap: 16px;
    align-items: center;
  }

  .site-title {
    justify-self: start;
  }

  .header-nav {
    justify-self: center;
  }

  .header-right {
    justify-self: end;
  }
}

/* ===== Bottom nav (mobile workflow steps) ===== */
.bottom-nav.v-bottom-navigation {
  padding-bottom: env(safe-area-inset-bottom, 0px);
  position: relative;
  z-index: 8;
  background: var(--rro-header-bg);
  border-top: 1px solid var(--rro-border);
}

.bottom-nav .v-btn {
  font-family: var(--rro-font-sans);
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0;
  text-transform: none;
  color: var(--rro-text-muted);
}

.bottom-nav .v-btn--selected {
  color: var(--rro-accent);
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
  background: var(--rro-hover-bg);
  color: var(--rro-text-muted);
  border: 1px solid var(--rro-border);
  transition: background-color 0.2s, color 0.2s, border-color 0.2s;
}

.tab-label {
  line-height: 1.2;
}

.tab-tooltip-wrap {
  display: inline-flex;
  align-items: center;
}

.header-nav .v-tab--selected .tab-step,
.bottom-nav .v-btn--selected .tab-step {
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  border-color: transparent;
}

/*
 * ===== Touch input (iOS Safari / WebKit) =====
 *
 * Two independent problems made the controls feel dead on iPhone. Neither is a
 * stacking or hit-testing fault — every box was exactly where it looked:
 *
 * 1. Everything inherited `touch-action: auto`, so Safari kept double-tap-zoom
 *    armed over each control and withheld the synthetic `click` while it waited
 *    to see whether a second tap was coming. Tapping twice in quick succession
 *    (play/pause, frame stepping, workflow nav) zoomed the page instead of
 *    activating the button. `manipulation` still allows scrolling and
 *    pinch-zoom — it only drops the double-tap gesture, and the wait with it.
 *    It is declared on the root because touch-action resolves as the
 *    intersection along the hit-test chain, so one declaration covers every
 *    descendant (including overlays teleported to <body>) while the three.js
 *    canvas keeps OrbitControls' stricter `touch-action: none`.
 *
 * 2. The global `VBtn` comfortable density (src/plugins/vuetify.ts) subtracts
 *    8px, so our `size="small"` chrome rendered at 20–28 CSS px — the metrics
 *    collapse toggle was 20x20 and the workflow nav buttons 134x20. Apple's
 *    minimum is 44x44pt, so a fingertip mostly landed outside the box and the
 *    tap did nothing at all.
 *
 * This block must stay last: it widens `.site-header .header-btn`, which the
 * `max-width: 959.98px` block above narrows at the same specificity.
 */
html {
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}

@media (pointer: coarse), (hover: none) {
  /*
   * Vuetify buttons clip to their own box (`.v-btn { overflow: hidden }`), so
   * their hit area has to come from the box itself rather than a pseudo-element.
   * `min-*` only ever grows a control, and the `.v-application` prefix keeps
   * these ahead of the per-view scoped rules that place `.panel-fab`.
   */
  .v-application .panel-fab.v-btn,
  .v-application .workflow-nav .v-btn,
  .v-application .playback-bar .v-btn,
  .v-application .metrics-header .v-btn,
  .v-application .metrics-header .v-tab {
    min-width: var(--rro-tap-target);
    min-height: var(--rro-tap-target);
  }

  /*
   * VTabs pins its slide group to the density height and paints it with
   * `contain: content`, so a taller .v-tab grows and is then clipped straight
   * back to 36px of hit area. Open the track up to match the tabs inside it.
   */
  .v-application .metrics-header .v-tabs,
  .v-application .metrics-header .v-slide-group__container,
  .v-application .metrics-header .v-slide-group__content {
    height: var(--rro-tap-target);
  }

  /*
   * The header links are native elements with no clipping, so they keep their
   * pill look and take the missing height from a centred overlay. Widening them
   * to a full 44px also pushes centre-to-centre spacing past 44, so neighbouring
   * overlays meet edge to edge instead of reaching over each other's pills.
   */
  .site-header .header-btn,
  .site-header .github-link {
    min-width: var(--rro-tap-target);
  }

  .site-header .header-btn,
  .site-header .github-link,
  .site-header .site-title {
    position: relative;
  }

  .site-header .header-btn::after,
  .site-header .github-link::after,
  .site-header .site-title::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: max(100%, var(--rro-tap-target));
    height: var(--rro-tap-target);
    transform: translate(-50%, -50%);
  }
}

</style>
