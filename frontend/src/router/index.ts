import { createRouter, createWebHistory } from 'vue-router'
import AppLayout from '@/layouts/AppLayout.vue'
import SignIn from '@/pages/auth/user/SignIn.vue'
import ChangePassword from '@/pages/auth/user/ChangePassword.vue'
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
      path: '/change-password',
      name: 'change-password',
      component: ChangePassword,
      meta: { requiresAuth: true, restrictedSession: true, title: '修改密码' },
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
          path: 'admin/system-parameter',
          name: 'page:admin/system-parameter',
          component: () =>
            import('@/pages/admin/system-parameter/SystemParameter.vue'),
          meta: {
            requiresAuth: true,
            requiredPermission: '/app/system-parameter/query',
            title: '系统参数',
          },
        },
        {
          path: 'admin/menu',
          name: 'page:admin/menu',
          component: () => import('@/pages/admin/menu/Menu.vue'),
          meta: {
            requiresAuth: true,
            requiredAnyPermissions: [
              '/app/menu/save-business-template',
              '/app/menu/activate',
              '/app/menu/reset-business-template',
            ],
            title: '菜单管理',
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
