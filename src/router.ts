import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

import { STUDY_CONDITIONS } from '@/app/study/runtime'

const studyRoutes: RouteRecordRaw[] = STUDY_CONDITIONS.flatMap((condition) => [
  {
    path: `/canvas/${condition}`,
    name: `canvas-${condition}`,
    component: () => import('./views/EditorView.vue'),
    meta: { studyHost: 'lencanvas', studyCondition: condition }
  },
  {
    path: `/chat/${condition}`,
    name: `chat-${condition}`,
    component: () => import('./views/ChatView.vue'),
    meta: { studyHost: 'lenchat', studyCondition: condition }
  }
])

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/canvas/userlens' },
    { path: '/canvas', redirect: '/canvas/userlens' },
    { path: '/chat', redirect: '/chat/userlens' },
    ...studyRoutes,
    {
      path: '/demo',
      component: () => import('./views/EditorView.vue'),
      meta: { demo: true, studyHost: 'lencanvas', studyCondition: 'userlens' }
    },
    {
      path: '/share/:roomId',
      component: () => import('./views/EditorView.vue'),
      meta: { studyHost: 'lencanvas', studyCondition: 'userlens' }
    }
  ]
})

export default router
