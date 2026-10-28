<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useDisplay } from 'vuetify';
import { icons } from '@/lib/icons';
import { useI18n } from '@/i18n';
import { useMotionStore } from '@/stores/motion';
import { useRetargetStore } from '@/stores/retarget';
import {
  GALLERY_CATEGORIES,
  GALLERY_SITE_URL,
  galleryRobotUrl,
  galleryThumbUrl,
  galleryVariantView,
  loadGalleryRobots,
  urdfVariants,
  type GalleryCategory,
  type GalleryRobot,
} from '@/lib/gallery/registry';

const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ imported: [] }>();

const { t } = useI18n();
const { xs } = useDisplay();
const motion = useMotionStore();
const store = useRetargetStore();

const robots = ref<GalleryRobot[]>([]);
const listLoading = ref(false);
const listError = ref<string | null>(null);
const category = ref<GalleryCategory>('humanoid');
const query = ref('');
const selectedId = ref<string | null>(null);
const variantId = ref<string | null>(null);
const importing = ref(false);
const progress = ref({ done: 0, total: 0 });
const error = ref<string | null>(null);

/** The loaded motion decides which family can be retargeted to (none for SMPL-X). */
const allowedCategories = computed((): GalleryCategory[] => {
  const kind = motion.motionKind;
  if (kind === 'smplx') return [];
  if (kind === 'humanoid' || kind === 'quadruped') return [kind];
  return GALLERY_CATEGORIES;
});

const countBy = computed(() => {
  const counts: Record<string, number> = {};
  for (const r of robots.value) counts[r.category] = (counts[r.category] ?? 0) + 1;
  return counts;
});

const filtered = computed(() => {
  const terms = query.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return robots.value.filter((r) => {
    if (r.category !== category.value) return false;
    const hay = [r.id, r.name, r.maker ?? '', ...urdfVariants(r).map((v) => v.name)].join(' ').toLowerCase();
    return terms.every((term) => hay.includes(term));
  });
});

const selected = computed(
  () => robots.value.find((r) => r.id === selectedId.value && r.category === category.value) ?? null,
);
const variantItems = computed(() =>
  selected.value ? urdfVariants(selected.value).map((v) => ({ title: v.name, value: v.id })) : [],
);
const selectedView = computed(() => (selected.value ? galleryVariantView(selected.value, variantId.value) : null));
const selectedUrl = computed(() =>
  selected.value ? galleryRobotUrl(selected.value.id, selectedView.value?.variant?.id) : GALLERY_SITE_URL + 'web/',
);
const canLoad = computed(
  () =>
    !!selected.value &&
    !importing.value &&
    (allowedCategories.value as string[]).includes(selected.value.category),
);
const progressPct = computed(() =>
  progress.value.total > 0 ? (100 * progress.value.done) / progress.value.total : 0,
);

function formatMb(bytes?: number): string {
  return bytes ? `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB` : '';
}

function subtitle(r: GalleryRobot): string {
  const parts = [r.maker ?? '—', `${r.dof} DoF`];
  const variants = urdfVariants(r).length;
  if (variants > 1) parts.push(`${variants} ${t('galleryVariant')}`);
  return parts.join(' · ');
}

async function fetchList() {
  listLoading.value = true;
  listError.value = null;
  try {
    robots.value = await loadGalleryRobots();
  } catch (err) {
    listError.value = `${t('galleryRegistryError')}: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    listLoading.value = false;
  }
}

function select(r: GalleryRobot) {
  if (importing.value) return;
  selectedId.value = r.id;
  variantId.value = urdfVariants(r)[0]?.id ?? null;
  error.value = null;
}

function onOpenChange(v: boolean) {
  if (v) {
    // Reopen on the robot loaded last time, when the loaded motion still allows it.
    const loaded = store.customRobot;
    if (loaded?.gallery && loaded.kind && allowedCategories.value.includes(loaded.kind)) {
      category.value = loaded.kind;
      if (!selectedId.value) {
        selectedId.value = loaded.gallery.id;
        variantId.value = loaded.gallery.variant;
      }
    } else if (!allowedCategories.value.includes(category.value)) {
      category.value = allowedCategories.value[0] ?? 'humanoid';
    }
    if (!robots.value.length) void fetchList();
  } else if (!importing.value) {
    error.value = null;
  }
}
// Immediate: the config page mounts this dialog lazily, already open.
watch(open, onOpenChange, { immediate: true });

async function load() {
  const robot = selected.value;
  if (!robot || !canLoad.value) return;
  importing.value = true;
  error.value = null;
  progress.value = { done: 0, total: 0 };
  try {
    await store.importGalleryRobot(robot, selectedView.value?.variant?.id ?? null, (done, total) => {
      progress.value = { done, total };
    });
    emit('imported');
    open.value = false;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <v-dialog v-model="open" max-width="720" scrollable :fullscreen="xs" :persistent="importing">
    <v-card :class="{ 'gallery-card--capped': !xs }">
      <v-card-title class="d-flex align-center justify-space-between py-3">
        <span class="text-truncate">{{ t('galleryTitle') }}</span>
        <v-btn :icon="icons.close" variant="text" size="small" :disabled="importing" @click="open = false" />
      </v-card-title>

      <div class="px-4 pb-2 d-flex flex-column ga-2">
        <div class="text-body-2 text-medium-emphasis">
          {{ t('galleryHint') }}
          <a :href="GALLERY_SITE_URL + 'web/'" target="_blank" rel="noopener" class="gallery-link">
            {{ t('galleryOpenSite') }}
            <v-icon :icon="icons.openExternal" size="x-small" />
          </a>
        </div>
        <v-alert v-if="motion.motionKind === 'smplx'" type="info" density="compact" variant="tonal" class="text-body-2">
          {{ t('gallerySmplxHint') }}
        </v-alert>
        <div v-else-if="motion.motionKind" class="text-caption text-medium-emphasis">
          {{ t('galleryKindFiltered') }}
        </div>
        <div class="d-flex flex-wrap align-center ga-2">
          <v-btn-toggle
            v-model="category"
            mandatory
            density="compact"
            variant="outlined"
            divided
            color="primary"
            class="gallery-category"
          >
            <v-btn
              v-for="c in GALLERY_CATEGORIES"
              :key="c"
              :value="c"
              :disabled="!allowedCategories.includes(c) || importing"
            >
              {{ c === 'humanoid' ? t('galleryHumanoid') : t('galleryQuadruped') }}
              <span v-if="countBy[c]" class="ml-1 text-medium-emphasis">{{ countBy[c] }}</span>
            </v-btn>
          </v-btn-toggle>
          <v-text-field
            v-model="query"
            :prepend-inner-icon="icons.search"
            :placeholder="t('gallerySearch')"
            density="compact"
            hide-details
            clearable
            class="gallery-search"
          />
        </div>
      </div>

      <v-divider />

      <v-card-text class="gallery-list pa-0">
        <div v-if="listLoading" class="d-flex justify-center py-8">
          <v-progress-circular indeterminate color="primary" />
        </div>
        <div v-else-if="listError" class="pa-4 d-flex flex-column align-start ga-2">
          <v-alert type="error" density="compact" variant="tonal" class="text-body-2">{{ listError }}</v-alert>
          <v-btn variant="tonal" size="small" @click="fetchList">{{ t('galleryRetry') }}</v-btn>
        </div>
        <div v-else-if="!filtered.length" class="pa-6 text-center text-medium-emphasis">{{ t('galleryEmpty') }}</div>
        <v-list v-else density="compact" class="py-0">
          <v-list-item
            v-for="r in filtered"
            :key="r.id"
            :active="r.id === selectedId"
            :disabled="importing"
            color="primary"
            class="gallery-item"
            @click="select(r)"
          >
            <template #prepend>
              <img :src="galleryThumbUrl(r.id)" alt="" loading="lazy" class="gallery-thumb mr-3" />
            </template>
            <v-list-item-title>{{ r.name }}</v-list-item-title>
            <v-list-item-subtitle>{{ subtitle(r) }}</v-list-item-subtitle>
          </v-list-item>
        </v-list>
      </v-card-text>

      <v-divider />

      <div class="px-4 pt-3 d-flex flex-column ga-2">
        <template v-if="selected">
          <div class="d-flex align-center ga-2 flex-wrap">
            <span class="text-subtitle-2">{{ selected.name }}</span>
            <span class="text-caption text-medium-emphasis">
              {{ selectedView?.dof }} DoF
              <template v-if="selectedView?.assets.mesh_bytes"> · {{ formatMb(selectedView.assets.mesh_bytes) }}</template>
              <template v-if="selected.license"> · {{ selected.license }}</template>
            </span>
          </div>
          <v-select
            v-if="variantItems.length > 1"
            v-model="variantId"
            :items="variantItems"
            :label="t('galleryVariant')"
            :disabled="importing"
            density="compact"
            hide-details
          />
        </template>
        <v-progress-linear v-if="importing" :model-value="progressPct" color="primary" height="18" rounded>
          <span class="text-caption">{{ t('galleryDownloading') }} {{ progress.done }}/{{ progress.total }}</span>
        </v-progress-linear>
        <v-alert v-if="error" type="error" density="compact" variant="tonal" class="text-body-2">{{ error }}</v-alert>
      </div>

      <v-card-actions class="gallery-actions px-4 pb-3 flex-wrap ga-2">
        <v-btn
          variant="text"
          :prepend-icon="icons.openExternal"
          :disabled="!selected"
          :href="selected ? selectedUrl : undefined"
          target="_blank"
          rel="noopener"
        >
          {{ t('viewInGallery') }}
        </v-btn>
        <v-spacer />
        <v-btn variant="text" :disabled="importing" @click="open = false">{{ t('close') }}</v-btn>
        <v-btn color="primary" variant="flat" :prepend-icon="icons.download" :disabled="!canLoad" :loading="importing" @click="load">
          {{ t('galleryLoad') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.gallery-card--capped {
  max-height: min(88vh, 860px);
}
.gallery-list {
  min-height: 120px;
}
.gallery-card--capped .gallery-list {
  min-height: 220px;
}
.gallery-search {
  flex: 1 1 200px;
  min-width: 160px;
}
.gallery-thumb {
  width: 48px;
  height: 48px;
  object-fit: contain;
  border-radius: var(--rro-radius);
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.gallery-item {
  min-height: 56px;
}
.gallery-link {
  color: rgb(var(--v-theme-primary));
  white-space: nowrap;
}
/* 44px touch targets, as for the rest of the app chrome (see App.vue). */
@media (pointer: coarse), (hover: none) {
  .gallery-category {
    height: var(--rro-tap-target);
  }
  .gallery-category .v-btn {
    height: 100%;
  }
  .gallery-actions .v-btn {
    min-height: var(--rro-tap-target);
  }
}
</style>
