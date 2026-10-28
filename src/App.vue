<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDisplay } from 'vuetify';
import { useI18n } from '@/i18n';
import { useAppTheme } from '@/composables/useAppTheme';
import { useMotionStore } from '@/stores/motion';
import { useRetargetStore } from '@/stores/retarget';
import { icons } from '@/lib/icons';

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

// Loaded on first open (it also pulls in the canvas-blur helper).
const SponsorDialog = defineAsyncComponent(() => import('@/components/SponsorDialog.vue'));
const sponsorOpen = ref(false);
const sponsorUsed = ref(false);
function openSponsor() {
  sponsorUsed.value = true;
  sponsorOpen.value = true;
}

// A `#main-content` href would be read as a route by the hash router, so the
// skip link moves focus itself.
const mainEl = ref<{ $el: HTMLElement } | null>(null);
function skipToContent() {
  mainEl.value?.$el.focus();
}

// re-render tab labels on locale change
void locale.value;
</script>

<template>
  <v-app>
    <a class="skip-link" href="#main-content" @click.prevent="skipToContent">{{ t('skipToContent') }}</a>

    <v-app-bar :height="56" flat class="site-header">
      <div class="header-inner">
        <router-link :to="{ name: 'bvh' }" class="site-title" :aria-label="t('appTitleBilingual')">
          <span class="site-title-mark" aria-hidden="true"><v-icon :icon="icons.brandMark" size="16" /></span>
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
            :aria-label="`${localeLabel} · ${t('switchLanguage')}`"
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
            <Transition name="icon-swap" mode="out-in">
              <v-icon :key="isDark ? 'sun' : 'moon'" :icon="isDark ? icons.sun : icons.moon" size="18" />
            </Transition>
          </button>
          <button
            type="button"
            class="header-btn sponsor-toggle"
            :aria-label="t('sponsorTitle')"
            :title="t('sponsorTitle')"
            aria-haspopup="dialog"
            @click="openSponsor"
          >
            <v-icon :icon="icons.coffee" size="18" />
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

    <v-main id="main-content" ref="mainEl" class="app-main" tabindex="-1">
      <router-view v-slot="{ Component }">
        <keep-alive>
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </v-main>

    <SponsorDialog v-if="sponsorUsed" v-model="sponsorOpen" />
  </v-app>
</template>

<style>
/*
 * Header chrome follows Humanoid_Robot_Learning_Paper_Notebooks' `.site-header`
 * (bold sans title, GitHub text link, compact toggles). Tokens (colours, radii,
 * motion, fonts) live in src/styles/design.css; `data-theme` is set on <html>
 * by useAppTheme.
 */
@media (max-width: 959.98px) {
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

.app-main:focus {
  outline: none;
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
  gap: 12px;
  width: 100%;
  min-width: 0;
  height: 100%;
  padding-inline: 24px;
}

.site-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-family: var(--rro-font-sans);
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.5rem;
  letter-spacing: -0.01em;
  color: var(--rro-text);
  text-decoration: none;
  transition: color var(--rro-dur-color) var(--rro-ease);
}

.site-title:hover {
  color: var(--rro-accent);
}

.site-title-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  font-size: 16px;
  transition: transform var(--rro-dur-move) var(--rro-ease);
}

.site-title:hover .site-title-mark {
  transform: rotate(180deg);
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
  gap: 8px;
  flex: 0 0 auto;
}

.site-header .github-link {
  display: inline-flex;
  align-items: center;
  height: 32px;
  padding-inline: 4px;
  border-radius: var(--rro-radius);
  font-family: var(--rro-font-sans);
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--rro-text-muted);
  text-decoration: none;
  transition: color var(--rro-dur-color) var(--rro-ease);
}

.site-header .github-link:hover {
  color: var(--rro-text);
}

.site-header .header-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  min-width: 32px;
  height: 32px;
  padding: 0 8px;
  background: none;
  border: 1px solid var(--rro-border);
  border-radius: var(--rro-radius);
  color: var(--rro-text-muted);
  font-family: var(--rro-font-sans);
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  user-select: none;
  transition:
    color var(--rro-dur-color) var(--rro-ease),
    background-color var(--rro-dur-color) var(--rro-ease),
    border-color var(--rro-dur-color) var(--rro-ease),
    transform var(--rro-dur-color) var(--rro-ease);
}

.site-header .header-btn:hover {
  background: var(--rro-hover-bg);
  color: var(--rro-text);
}

.site-header .header-btn:active {
  transform: translateY(1px);
}

.site-header .header-btn:focus-visible,
.site-header .github-link:focus-visible,
.site-header .site-title:focus-visible {
  outline: 2px solid var(--rro-accent);
  outline-offset: 2px;
}

/* One accent: the sponsor cup only takes its own colour while it is pointed at. */
.site-header .sponsor-toggle:hover {
  border-color: var(--rro-sponsor);
  background: rgba(226, 86, 106, 0.12);
  color: var(--rro-sponsor);
}

.icon-swap-enter-active,
.icon-swap-leave-active {
  transition:
    opacity var(--rro-dur-color) var(--rro-ease),
    transform var(--rro-dur-move) var(--rro-ease);
}

.icon-swap-enter-from {
  opacity: 0;
  transform: rotate(-90deg) scale(0.6);
}

.icon-swap-leave-to {
  opacity: 0;
  transform: rotate(90deg) scale(0.6);
}

/* ===== Header nav (workflow steps) ===== */
.header-nav {
  flex-shrink: 0;
}

.header-nav .v-tab.v-btn {
  min-width: 0;
  padding-inline: 16px;
  font-family: var(--rro-font-sans);
  font-size: 0.875rem;
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
  color: var(--rro-text);
}

@media (max-width: 959.98px) {
  .header-inner {
    gap: 8px;
    padding-inline: 12px;
  }

  .site-title {
    flex: 1 1 0;
    font-size: 0.875rem;
    line-height: 1.25rem;
  }

  .header-right {
    gap: 4px;
  }

  .site-header .github-link {
    font-size: 0.75rem;
  }

  .site-header .header-btn {
    min-width: 32px;
    padding: 0 8px;
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
  border-radius: 0 !important;
  font-family: var(--rro-font-sans);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0;
  text-transform: none;
  color: var(--rro-text-muted);
}

.bottom-nav .v-btn--selected {
  color: var(--rro-text);
}

.tab-with-step {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.tab-with-step--compact {
  flex-direction: column;
  gap: 4px;
}

.tab-step {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
  background: var(--rro-hover-bg);
  color: var(--rro-text-muted);
  border: 1px solid var(--rro-border);
  transition:
    background-color var(--rro-dur-color) var(--rro-ease),
    color var(--rro-dur-color) var(--rro-ease),
    border-color var(--rro-dur-color) var(--rro-ease);
}

.tab-label {
  line-height: 1.25rem;
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

  /*
   * The drawer and dialog scrims close on `click`, but they are plain <div>s,
   * and Safari has never dispatched click for a tap on an element it does not
   * consider clickable — tapping beside the panel left it open. `cursor:
   * pointer` is what makes Safari consider one clickable; src/lib/tapFallback.ts
   * covers the device that dispatches no mouse events at all.
   */
  .v-navigation-drawer__scrim,
  .v-overlay__scrim {
    cursor: pointer;
  }
}

</style>
