import { createRouter, createWebHashHistory } from 'vue-router';
import { isPageReload, workflowRouteRedirect } from '@/lib/navigation';
import { useMotionStore } from '@/stores/motion';
import { useRetargetStore } from '@/stores/retarget';

const router = createRouter({
  // Hash history avoids 404s on GitHub Pages refresh/deep-link.
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/bvh' },
    {
      path: '/bvh',
      name: 'bvh',
      component: () => import('@/views/BvhViewerView.vue'),
    },
    {
      path: '/config',
      name: 'config',
      component: () => import('@/views/RetargetConfigView.vue'),
    },
    {
      path: '/preview',
      name: 'preview',
      component: () => import('@/views/RetargetPreviewView.vue'),
    },
  ],
});

router.beforeEach((to) => {
  const motion = useMotionStore();
  const retarget = useRetargetStore();
  return workflowRouteRedirect(to.name, motion.hasMotion, retarget.hasHistory);
});

// Pinia state is in-memory only — after a full reload, config/preview would be empty.
// Always land on BVH preview so the user can load motion again.
router.isReady().then(() => {
  if (!isPageReload()) return;
  if (router.currentRoute.value.name === 'bvh') return;
  void router.replace({
    name: 'bvh',
    query: router.currentRoute.value.query,
  });
});

export default router;
