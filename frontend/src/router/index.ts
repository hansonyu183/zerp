import { createRouter, createWebHistory } from 'vue-router'
import AppLayout from '@/layouts/AppLayout.vue'
import SignIn from '@/pages/auth/user/SignIn.vue'
import Dashboard from '@/pages/home/dashboard/Dashboard.vue'
import NotFound from '@/pages/system/notfound/NotFound.vue'
import Forbidden from '@/pages/system/forbidden/Forbidden.vue'
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
          meta: { requiresAuth: true, title: '工作台' },
        },
        {
          path: 'admin/user',
          name: 'page:admin/user',
          component: () => import('@/pages/admin/user/User.vue'),
          meta: {
            requiresAuth: true,
            requiredPermission: '/app/user/query',
            title: '用户管理',
          },
        },
        {
          path: 'admin/role',
          name: 'page:admin/role',
          component: () => import('@/pages/admin/role/Role.vue'),
          meta: {
            requiresAuth: true,
            requiredPermission: '/app/role/query',
            title: '角色管理',
          },
        },
        {
          path: 'admin/permission',
          name: 'page:admin/permission',
          component: () => import('@/pages/admin/permission/Permission.vue'),
          meta: {
            requiresAuth: true,
            requiredPermission: '/app/permission/query',
            title: '权限管理',
          },
        },
        {
          path: 'forbidden',
          name: 'forbidden',
          component: Forbidden,
          meta: { requiresAuth: true, title: '无权访问' },
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
