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
  <aside v-if="mdAndUp" class="side-panel pa-3 d-flex flex-column ga-3">
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
    <div class="pa-3 d-flex flex-column ga-3">
      <slot />
    </div>
  </v-navigation-drawer>
</template>

<style scoped>
.side-panel {
  width: 300px;
  min-width: 300px;
  flex-shrink: 0;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  overflow-y: auto;
}
.side-drawer :deep(.v-navigation-drawer__content) {
  overflow-y: auto;
}
</style>
