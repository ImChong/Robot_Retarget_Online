<script setup lang="ts">
import { useI18n } from '@/i18n';
import { icons } from '@/lib/icons';

const { t } = useI18n();
</script>

<template>
  <section class="not-found" aria-labelledby="not-found-title">
    <span class="not-found__mark" aria-hidden="true">
      <v-icon :icon="icons.robot" size="24" />
    </span>
    <p class="not-found__code">404</p>
    <h1 id="not-found-title" class="not-found__title">{{ t('notFoundTitle') }}</h1>
    <p class="not-found__body">{{ t('notFoundHint') }}</p>
    <v-btn color="primary" variant="flat" :prepend-icon="icons.caretLeft" :to="{ name: 'bvh' }">
      {{ t('notFoundAction') }}
    </v-btn>
  </section>
</template>

<style scoped>
.not-found {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 24px 16px 32px;
  text-align: center;
}
.not-found__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: var(--rro-radius-lg);
  background: rgba(var(--v-theme-primary), 0.14);
  color: rgb(var(--v-theme-primary));
}
.not-found__code {
  margin: 16px 0 0;
  font-family: var(--rro-font-mono);
  font-size: 0.75rem;
  line-height: 1rem;
  letter-spacing: 0.08em;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
.not-found__title {
  margin: 4px 0 0;
  font-size: 1.5rem;
  line-height: 2rem;
  font-weight: 600;
  letter-spacing: -0.015em;
}
.not-found__body {
  max-width: 42ch;
  margin: 8px 0 24px;
  font-size: 0.875rem;
  line-height: 1.25rem;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
</style>
