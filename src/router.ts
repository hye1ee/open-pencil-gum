import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('./views/EditorView.vue') },
    { path: '/chat', component: () => import('./views/ChatView.vue') },
    { path: '/demo', component: () => import('./views/EditorView.vue'), meta: { demo: true } },
    { path: '/share/:roomId', component: () => import('./views/EditorView.vue') }
  ]
})

export default router
