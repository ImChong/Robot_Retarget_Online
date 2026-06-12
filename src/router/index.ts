import { createRouter, createWebHashHistory } from 'vue-router';

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

export default router;
