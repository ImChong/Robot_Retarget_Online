<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from '@/i18n';
import { mountSponsorCanvasBlurs } from '@/lib/sponsorCanvasBlur';

const open = defineModel<boolean>({ required: true });

const { t } = useI18n();
const sponsorQrSrc = `${import.meta.env.BASE_URL}sponsor/wechat-pay.png`;

let clearCanvasBlurs: (() => void) | null = null;
const canvasBlurHost = ref<HTMLElement | null>(null);

function close() {
  open.value = false;
}

function syncCanvasBlurs() {
  clearCanvasBlurs?.();
  clearCanvasBlurs = null;
  if (!open.value || !canvasBlurHost.value) return;
  clearCanvasBlurs = mountSponsorCanvasBlurs(canvasBlurHost.value);
}

function setBodyScrollBlocked(blocked: boolean) {
  document.body.classList.toggle('sponsor-dialog-open', blocked);
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close();
}

watch(open, async (isOpen) => {
  setBodyScrollBlocked(isOpen);
  if (isOpen) {
    await nextTick();
    syncCanvasBlurs();
    document.addEventListener('keydown', onKeydown);
  } else {
    clearCanvasBlurs?.();
    clearCanvasBlurs = null;
    document.removeEventListener('keydown', onKeydown);
  }
});

onBeforeUnmount(() => {
  setBodyScrollBlocked(false);
  clearCanvasBlurs?.();
  clearCanvasBlurs = null;
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="sponsor-dialog"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="'sponsor-dialog-title'"
    >
      <div ref="canvasBlurHost" class="sponsor-canvas-blur-host" aria-hidden="true" />
      <button type="button" class="sponsor-dialog-backdrop" aria-label="Close" @click="close" />
      <div class="sponsor-dialog-card">
        <div class="sponsor-dialog-header">
          <h2 id="sponsor-dialog-title" class="sponsor-dialog-title">{{ t('sponsorTitle') }}</h2>
          <p class="sponsor-dialog-hint">{{ t('sponsorHint') }}</p>
        </div>
        <div class="sponsor-dialog-body">
          <img :src="sponsorQrSrc" :alt="t('sponsorImgAlt')" class="sponsor-qr" />
        </div>
        <div class="sponsor-dialog-actions">
          <button type="button" class="sponsor-dialog-close" @click="close">{{ t('close') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style>
body.sponsor-dialog-open {
  overflow: hidden !important;
}

.sponsor-dialog {
  position: fixed;
  inset: 0;
  z-index: 2400;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.sponsor-canvas-blur-host {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  overflow: hidden;
}

.sponsor-canvas-blur {
  position: fixed;
  overflow: hidden;
  pointer-events: none;
}

.sponsor-canvas-blur img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: blur(16px);
  -webkit-filter: blur(16px);
  transform: scale(1.08);
}

.sponsor-dialog-backdrop {
  position: absolute;
  inset: 0;
  z-index: 1;
  border: 0;
  padding: 0;
  margin: 0;
  cursor: default;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.sponsor-dialog-card {
  position: relative;
  z-index: 2;
  width: min(100%, 340px);
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 16px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}

.sponsor-dialog-header {
  padding: 20px 20px 8px;
  text-align: center;
}

.sponsor-dialog-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
}

.sponsor-dialog-hint {
  margin: 6px 0 0;
  font-size: 0.9rem;
  color: rgba(var(--v-theme-on-surface), 0.68);
}

.sponsor-dialog-body {
  display: flex;
  justify-content: center;
  padding: 8px 20px 4px;
}

.sponsor-qr {
  display: block;
  width: 100%;
  max-width: 260px;
  height: auto;
  border-radius: 12px;
}

.sponsor-dialog-actions {
  display: flex;
  justify-content: center;
  padding: 12px 20px 20px;
}

.sponsor-dialog-close {
  appearance: none;
  border: 0;
  border-radius: 999px;
  padding: 8px 20px;
  font: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.12);
}

.sponsor-dialog-close:hover {
  background: rgba(var(--v-theme-primary), 0.2);
}
</style>
