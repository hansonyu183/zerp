import {
  createRouter,
  createWebHistory,
  type Router,
  type RouterHistory,
} from 'vue-router'
import AppLayout from '../layouts/AppLayout.vue'
import MenuManagement from '../pages/app/menu/MenuManagement.vue'
import PermissionManagement from '../pages/app/permission/PermissionManagement.vue'
import RoleManagement from '../pages/app/role/RoleManagement.vue'
import SystemParameterManagement from '../pages/app/system-parameter/SystemParameterManagement.vue'
import UserManagement from '../pages/app/user/UserManagement.vue'
import AuxMaintenance from '../pages/aux/shared/AuxMaintenance.vue'
import ChangePassword from '../pages/auth/change-password/ChangePassword.vue'
import SignIn from '../pages/auth/signin/SignIn.vue'
import Dashboard from '../pages/home/dashboard/Dashboard.vue'
import Forbidden from '../pages/system/Forbidden.vue'
import NotFound from '../pages/system/NotFound.vue'

export function createTargetRouter(history: RouterHistory): Router {
  return createRouter({
    history,
    routes: [
      {
        path: '/signin',
        name: 'signin',
        component: SignIn,
        meta: { public: true, title: '登录', useCaseKey: 'app/signin' },
      },
      {
        path: '/change-password',
        name: 'change-password',
        component: ChangePassword,
        meta: {
          requiresAuth: true,
          restrictedSession: true,
          title: '修改密码',
          useCaseKey: 'app/change-password',
        },
      },
      {
        path: '/',
        name: 'app',
        component: AppLayout,
        meta: { requiresAuth: true },
        children: [
          { path: '', name: 'app-home-redirect', redirect: '/home/dashboard' },
          {
            path: 'home/dashboard',
            name: 'page:home/dashboard',
            component: Dashboard,
            meta: {
              requiresAuth: true,
              title: '工作台',
              useCaseKey: 'app/dashboard',
            },
          },
          {
            path: 'app/user',
            name: 'page:app/user',
            component: UserManagement,
            meta: {
              requiresAuth: true,
              requiredPermission: '/app/user/query',
              title: '用户管理',
              useCaseKey: 'app/user',
            },
          },
          {
            path: 'app/role',
            name: 'page:app/role',
            component: RoleManagement,
            meta: {
              requiresAuth: true,
              requiredPermission: '/app/role/query',
              title: '角色管理',
              useCaseKey: 'app/role',
            },
          },
          {
            path: 'app/permission',
            name: 'page:app/permission',
            component: PermissionManagement,
            meta: {
              requiresAuth: true,
              requiredPermission: '/app/permission/query',
              title: '权限目录',
              useCaseKey: 'app/permission',
            },
          },
          {
            path: 'app/system-parameter',
            name: 'page:app/system-parameter',
            component: SystemParameterManagement,
            meta: {
              requiresAuth: true,
              requiredPermission: '/app/system-parameter/query',
              title: '系统参数',
              useCaseKey: 'app/system-parameter',
            },
          },
          {
            path: 'app/menu',
            name: 'page:app/menu',
            component: MenuManagement,
            meta: {
              requiresAuth: true,
              requiredAnyPermissions: [
                '/app/menu/save-business',
                '/app/menu/activate',
                '/app/menu/reset-business',
              ],
              title: '菜单管理',
              useCaseKey: 'app/menu',
            },
          },
          {
            path: 'aux/product-category',
            name: 'page:aux/product-category',
            component: AuxMaintenance,
            props: { entity: 'product-category' },
            meta: {
              requiresAuth: true,
              requiredPermission: '/aux/product-category/query',
              title: '产品分类',
              useCaseKey: 'aux/product-category',
            },
          },
          {
            path: 'aux/product-type',
            name: 'page:aux/product-type',
            component: AuxMaintenance,
            props: { entity: 'product-type' },
            meta: {
              requiresAuth: true,
              requiredPermission: '/aux/product-type/query',
              title: '产品类型',
              useCaseKey: 'aux/product-type',
            },
          },
          {
            path: 'aux/employee-category',
            name: 'page:aux/employee-category',
            component: AuxMaintenance,
            props: { entity: 'employee-category' },
            meta: {
              requiresAuth: true,
              requiredPermission: '/aux/employee-category/query',
              title: '员工分类',
              useCaseKey: 'aux/employee-category',
            },
          },
          {
            path: 'aux/department',
            name: 'page:aux/department',
            component: AuxMaintenance,
            props: { entity: 'department' },
            meta: {
              requiresAuth: true,
              requiredPermission: '/aux/department/query',
              title: '部门',
              useCaseKey: 'aux/department',
            },
          },
          {
            path: 'aux/position',
            name: 'page:aux/position',
            component: AuxMaintenance,
            props: { entity: 'position' },
            meta: {
              requiresAuth: true,
              requiredPermission: '/aux/position/query',
              title: '岗位',
              useCaseKey: 'aux/position',
            },
          },
          {
            path: 'aux/settlement-method',
            name: 'page:aux/settlement-method',
            component: AuxMaintenance,
            props: { entity: 'settlement-method' },
            meta: {
              requiresAuth: true,
              requiredPermission: '/aux/settlement-method/query',
              title: '结算方式',
              useCaseKey: 'aux/settlement-method',
            },
          },
          {
            path: 'aux/payment-method',
            name: 'page:aux/payment-method',
            component: AuxMaintenance,
            props: { entity: 'payment-method' },
            meta: {
              requiresAuth: true,
              requiredPermission: '/aux/payment-method/query',
              title: '收款方式',
              useCaseKey: 'aux/payment-method',
            },
          },
          {
            path: 'aux/dictionary-type',
            name: 'page:aux/dictionary-type',
            component: AuxMaintenance,
            props: { entity: 'dictionary-type' },
            meta: {
              requiresAuth: true,
              requiredPermission: '/aux/dictionary-type/query',
              title: '字典类型',
              useCaseKey: 'aux/dictionary-type',
            },
          },
          {
            path: 'aux/dictionary-item',
            name: 'page:aux/dictionary-item',
            component: AuxMaintenance,
            props: { entity: 'dictionary-item' },
            meta: {
              requiresAuth: true,
              requiredPermission: '/aux/dictionary-item/query',
              title: '字典项',
              useCaseKey: 'aux/dictionary-item',
            },
          },
          {
            path: 'aux/measurement-unit',
            name: 'page:aux/measurement-unit',
            component: AuxMaintenance,
            props: { entity: 'measurement-unit' },
            meta: {
              requiresAuth: true,
              requiredPermission: '/aux/measurement-unit/query',
              title: '计量单位',
              useCaseKey: 'aux/measurement-unit',
            },
          },
          {
            path: 'aux/income-expense-type',
            name: 'page:aux/income-expense-type',
            component: AuxMaintenance,
            props: { entity: 'income-expense-type' },
            meta: {
              requiresAuth: true,
              requiredPermission: '/aux/income-expense-type/query',
              title: '收支类型',
              useCaseKey: 'aux/income-expense-type',
            },
          },
          {
            path: 'aux/asset-category',
            name: 'page:aux/asset-category',
            component: AuxMaintenance,
            props: { entity: 'asset-category' },
            meta: {
              requiresAuth: true,
              requiredPermission: '/aux/asset-category/query',
              title: '资产分类',
              useCaseKey: 'aux/asset-category',
            },
          },
          {
            path: 'forbidden',
            name: 'forbidden',
            component: Forbidden,
            meta: {
              requiresAuth: true,
              title: '无权访问',
              useCaseKey: 'app/forbidden',
            },
          },
        ],
      },
      {
        path: '/:pathMatch(.*)*',
        name: 'not-found',
        component: NotFound,
        meta: {
          requiresAuth: true,
          title: '页面不存在',
          useCaseKey: 'app/not-found',
        },
      },
    ],
  })
}

export const router = createTargetRouter(
  createWebHistory(import.meta.env.BASE_URL),
)
