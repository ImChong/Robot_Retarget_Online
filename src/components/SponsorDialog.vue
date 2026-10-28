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
      <button type="button" class="sponsor-dialog-backdrop" :aria-label="t('close')" @click="close" />
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
  z-index: var(--rro-z-dialog);
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
  filter: blur(8px);
  -webkit-filter: blur(8px);
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
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.sponsor-dialog-card {
  position: relative;
  z-index: 2;
  width: min(100%, 340px);
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: var(--rro-radius-xl);
  box-shadow: var(--rro-shadow-overlay);
  overflow: hidden;
}

.sponsor-dialog-header {
  padding: 24px 24px 8px;
  text-align: center;
}

.sponsor-dialog-title {
  margin: 0;
  font-size: 1.125rem;
  line-height: 1.75rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  text-wrap: balance;
}

.sponsor-dialog-hint {
  margin: 4px 0 0;
  font-size: 0.875rem;
  line-height: 1.25rem;
  color: rgba(var(--v-theme-on-surface), 0.68);
}

.sponsor-dialog-body {
  display: flex;
  justify-content: center;
  padding: 8px 24px 4px;
}

.sponsor-qr {
  display: block;
  width: 100%;
  max-width: 260px;
  height: auto;
  border-radius: var(--rro-radius-lg);
}

.sponsor-dialog-actions {
  display: flex;
  justify-content: center;
  padding: 16px 24px 24px;
}

.sponsor-dialog-close {
  appearance: none;
  border: 0;
  border-radius: var(--rro-radius);
  padding: 8px 24px;
  font: inherit;
  font-size: 0.875rem;
  line-height: 1.25rem;
  font-weight: 600;
  cursor: pointer;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.12);
  transition:
    background-color var(--rro-dur-color) var(--rro-ease),
    transform var(--rro-dur-color) var(--rro-ease);
}

.sponsor-dialog-close:hover {
  background: rgba(var(--v-theme-primary), 0.2);
}

.sponsor-dialog-close:active {
  transform: scale(0.98);
}

.sponsor-dialog-card {
  animation: sponsor-card-in var(--rro-dur-move) var(--rro-ease);
}

@keyframes sponsor-card-in {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.98);
  }
}
</style>
