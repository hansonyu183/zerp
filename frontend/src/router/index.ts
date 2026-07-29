import { createRouter, createWebHistory } from 'vue-router'
import AppLayout from '@/layouts/AppLayout.vue'
import SignIn from '@/pages/auth/user/SignIn.vue'
import Dashboard from '@/pages/home/dashboard/Dashboard.vue'
import NotFound from '@/pages/system/notfound/NotFound.vue'
import { pinia } from '@/stores'
import { useSessionStore } from '@/stores/session'
import { createSessionNavigationGuard, watchSessionMenuRoutes } from './guards'

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/signin',
      name: 'signin',
      component: SignIn,
      meta: { public: true, title: '登录' },
    },
    {
      path: '/',
      name: 'app',
      component: AppLayout,
      meta: { requiresAuth: true },
      children: [
        {
          path: '',
          name: 'app-home-redirect',
          redirect: '/home/dashboard',
        },
        {
          path: 'home/dashboard',
          name: 'page:home/dashboard',
          component: Dashboard,
          meta: { requiresAuth: true, title: '仪表盘' },
        },
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: NotFound,
      meta: { requiresAuth: true, title: '页面不存在' },
    },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

const session = useSessionStore(pinia)
watchSessionMenuRoutes(router, session)
router.beforeEach(createSessionNavigationGuard(router, session))

router.afterEach((to) => {
  const title = typeof to.meta.title === 'string' ? to.meta.title : ''
  document.title = title ? `${title} · ZERP` : 'ZERP'
})
