import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useMotionStore } from '@/stores/motion';
import { useRetargetStore } from '@/stores/retarget';

export type WorkflowStep = 'bvh' | 'config' | 'preview';

export function useWorkflowNav() {
  const route = useRoute();
  const router = useRouter();
  const motion = useMotionStore();
  const retarget = useRetargetStore();

  const step = computed(() => (route.name as WorkflowStep) ?? 'bvh');

  const canGoConfig = computed(() => motion.hasMotion);
  const canGoPreview = computed(() => retarget.hasHistory);
  const showNav = computed(() => step.value === 'bvh' || step.value === 'config');
  const isBusy = computed(() => retarget.isBusy);

  function goToConfig() {
    if (canGoConfig.value) void router.push({ name: 'config' });
  }

  function goToBvh() {
    void router.push({ name: 'bvh' });
  }

  async function runRetarget() {
    if (!canGoConfig.value || retarget.isBusy) return;
    await retarget.run();
    if (retarget.status === 'done') await router.push({ name: 'preview' });
  }

  function cancelRetarget() {
    retarget.cancel();
  }

  return {
    step,
    showNav,
    canGoConfig,
    canGoPreview,
    isBusy,
    goToConfig,
    goToBvh,
    runRetarget,
    cancelRetarget,
  };
}
