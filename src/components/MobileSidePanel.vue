<script setup lang="ts">
import { watch } from 'vue';
import { useDisplay } from 'vuetify';

const panelOpen = defineModel<boolean>({ default: false });
const { mdAndUp } = useDisplay();

watch(mdAndUp, (up) => {
  if (up) panelOpen.value = false;
});
</script>

<template>
  <aside v-if="mdAndUp" class="side-panel pa-4 d-flex flex-column ga-3">
    <slot />
  </aside>
  <v-navigation-drawer
    v-else
    v-model="panelOpen"
    temporary
    location="start"
    width="320"
    class="side-drawer"
  >
    <div class="pa-4 d-flex flex-column ga-3 side-drawer-inner">
      <slot />
    </div>
  </v-navigation-drawer>
</template>

<style scoped>
.side-panel {
  width: 300px;
  min-width: 300px;
  background: var(--rro-header-bg);
  flex-shrink: 0;
  height: 100%;
  min-height: 0;
  border-right: 1px solid var(--rro-border);
  overflow-y: auto;
  position: relative;
  z-index: 2;
}
/* Vuetify inputs default to flex: 1 1 auto and block buttons to flex: 1 0 auto,
   so in a column sidebar they stretch to soak up spare height; cards shrink and
   clip their last rows when the panel runs out of it. Size all three to content. */
.side-panel :deep(.v-input),
.side-drawer :deep(.v-input),
.side-panel :deep(.v-btn--block),
.side-drawer :deep(.v-btn--block),
.side-panel :deep(.v-card),
.side-drawer :deep(.v-card) {
  flex: 0 0 auto;
}
.side-drawer :deep(.v-navigation-drawer__content) {
  overflow-y: auto;
}
.side-drawer-inner {
  min-height: 100%;
}
</style>
