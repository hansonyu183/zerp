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
import Warehouse from '../pages/dcl/warehouse/Warehouse.vue'
import Product from '../pages/dcl/product/Product.vue'
import Customer from '../pages/dcl/customer/Customer.vue'
import DclAccMapping from '../pages/dcl/acc-mapping/AccMapping.vue'
import DclRptDefinition from '../pages/dcl/rpt-definition/RptDefinition.vue'
import DclWflProcessDefinition from '../pages/dcl/wfl-process-definition/WflProcessDefinition.vue'
import ArchiveWorkspace from '../pages/dcl/shared/ArchiveWorkspace.vue'
import AccBook from '../pages/acc/book/Book.vue'
import AccMapping from '../pages/acc/mapping/Mapping.vue'
import AccOpening from '../pages/acc/opening/Opening.vue'
import AccPeriod from '../pages/acc/period/Period.vue'
import AccSubject from '../pages/acc/subject/Subject.vue'
import RptReport from '../pages/rpt/report/Report.vue'
import DynamicProcess from '../pages/wfl/dynamic/DynamicProcess.vue'
import WflProcessDefinition from '../pages/wfl/process-definition/ProcessDefinition.vue'
import WflProcessInstance from '../pages/wfl/process-instance/ProcessInstance.vue'
import { vouPageComponents } from '../pages/vou/shared/page-components.ts'
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
            path: 'dcl/warehouse',
            name: 'page:dcl/warehouse',
            component: Warehouse,
            meta: {
              requiresAuth: true,
              requiredPermission: '/dcl/warehouse/query',
              title: '仓库申报',
              useCaseKey: 'dcl/warehouse',
            },
          },
          {
            path: 'dcl/operating-entity',
            name: 'page:dcl/operating-entity',
            component: ArchiveWorkspace,
            props: { entity: 'operating-entity' },
            meta: {
              requiresAuth: true,
              requiredPermission: '/dcl/operating-entity/query',
              title: '经营主体申报',
              useCaseKey: 'dcl/operating-entity',
            },
          },
          {
            path: 'dcl/vehicle',
            name: 'page:dcl/vehicle',
            component: ArchiveWorkspace,
            props: { entity: 'vehicle' },
            meta: {
              requiresAuth: true,
              requiredPermission: '/dcl/vehicle/query',
              title: '车辆申报',
              useCaseKey: 'dcl/vehicle',
            },
          },
          {
            path: 'dcl/fund-account',
            name: 'page:dcl/fund-account',
            component: ArchiveWorkspace,
            props: { entity: 'fund-account' },
            meta: {
              requiresAuth: true,
              requiredPermission: '/dcl/fund-account/query',
              title: '资金账户申报',
              useCaseKey: 'dcl/fund-account',
            },
          },
          {
            path: 'dcl/product',
            name: 'page:dcl/product',
            component: Product,
            meta: {
              requiresAuth: true,
              requiredPermission: '/dcl/product/query',
              title: '产品申报',
              useCaseKey: 'dcl/product',
            },
          },
          {
            path: 'dcl/employee',
            name: 'page:dcl/employee',
            component: ArchiveWorkspace,
            props: { entity: 'employee' },
            meta: {
              requiresAuth: true,
              requiredPermission: '/dcl/employee/query',
              title: '员工申报',
              useCaseKey: 'dcl/employee',
            },
          },
          {
            path: 'dcl/supplier',
            name: 'page:dcl/supplier',
            component: ArchiveWorkspace,
            props: { entity: 'supplier' },
            meta: {
              requiresAuth: true,
              requiredPermission: '/dcl/supplier/query',
              title: '供应商申报',
              useCaseKey: 'dcl/supplier',
            },
          },
          {
            path: 'dcl/customer',
            name: 'page:dcl/customer',
            component: Customer,
            meta: {
              requiresAuth: true,
              requiredPermission: '/dcl/customer/query',
              title: '客户申报',
              useCaseKey: 'dcl/customer',
            },
          },
          {
            path: 'dcl/other-unit',
            name: 'page:dcl/other-unit',
            component: ArchiveWorkspace,
            props: { entity: 'other-unit' },
            meta: {
              requiresAuth: true,
              requiredPermission: '/dcl/other-unit/query',
              title: '其他单位申报',
              useCaseKey: 'dcl/other-unit',
            },
          },
          {
            path: 'dcl/sales-partner',
            name: 'page:dcl/sales-partner',
            component: ArchiveWorkspace,
            props: { entity: 'sales-partner' },
            meta: {
              requiresAuth: true,
              requiredPermission: '/dcl/sales-partner/query',
              title: '销售合作方申报',
              useCaseKey: 'dcl/sales-partner',
            },
          },
          {
            path: 'dcl/acc-mapping',
            name: 'page:dcl/acc-mapping',
            component: DclAccMapping,
            meta: {
              requiresAuth: true,
              requiredPermission: '/dcl/acc-mapping/query',
              title: '会计映射申报',
              useCaseKey: 'dcl/acc-mapping',
            },
          },
          {
            path: 'dcl/rpt-definition',
            name: 'page:dcl/rpt-definition',
            component: DclRptDefinition,
            meta: {
              requiresAuth: true,
              requiredPermission: '/dcl/rpt-definition/query',
              title: '报表定义申报',
              useCaseKey: 'dcl/rpt-definition',
            },
          },
          {
            path: 'dcl/wfl-process-definition',
            name: 'page:dcl/wfl-process-definition',
            component: DclWflProcessDefinition,
            meta: {
              requiresAuth: true,
              requiredPermission: '/dcl/wfl-process-definition/query',
              title: '流程定义申报',
              useCaseKey: 'dcl/wfl-process-definition',
            },
          },
          {
            path: 'acc/book',
            name: 'page:acc/book',
            component: AccBook,
            meta: {
              requiresAuth: true,
              requiredPermission: '/acc/book/query',
              title: '会计账簿',
              useCaseKey: 'acc/book',
            },
          },
          {
            path: 'acc/subject',
            name: 'page:acc/subject',
            component: AccSubject,
            meta: {
              requiresAuth: true,
              requiredPermission: '/acc/subject/query',
              title: '会计科目',
              useCaseKey: 'acc/subject',
            },
          },
          {
            path: 'acc/mapping',
            name: 'page:acc/mapping',
            component: AccMapping,
            meta: {
              requiresAuth: true,
              requiredPermission: '/acc/mapping/query',
              title: '会计映射',
              useCaseKey: 'acc/mapping',
            },
          },
          {
            path: 'acc/opening',
            name: 'page:acc/opening',
            component: AccOpening,
            meta: {
              requiresAuth: true,
              requiredPermission: '/acc/opening/query',
              title: '会计期初',
              useCaseKey: 'acc/opening',
            },
          },
          {
            path: 'acc/period',
            name: 'page:acc/period',
            component: AccPeriod,
            meta: {
              requiresAuth: true,
              requiredPermission: '/acc/period/query',
              title: '会计期间',
              useCaseKey: 'acc/period',
            },
          },
          {
            path: 'wfl/process-definition',
            name: 'page:wfl/process-definition',
            component: WflProcessDefinition,
            meta: {
              requiresAuth: true,
              requiredPermission: '/wfl/process-definition/query',
              title: '流程定义',
              useCaseKey: 'wfl/process-definition',
            },
          },
          {
            path: 'wfl/process-instance',
            name: 'page:wfl/process-instance',
            component: WflProcessInstance,
            meta: {
              requiresAuth: true,
              requiredPermission: '/wfl/process-instance/query',
              title: '流程实例',
              useCaseKey: 'wfl/process-instance',
            },
          },
          {
            path: 'wfl/:processCode',
            name: 'page:wfl/dynamic-process',
            component: DynamicProcess,
            props: (route) => ({ processCode: route.params.processCode }),
            meta: {
              requiresAuth: true,
              requiresServerRoute: true,
              requiredPermission: '/wfl/process-instance/query',
              requiredDynamicPermission: 'wfl-query',
              title: '业务流程',
              useCaseKey: 'wfl/dynamic-process',
            },
          },
          {
            path: 'rpt/:reportCode',
            name: 'page:rpt/dynamic-report',
            component: RptReport,
            props: (route) => ({ reportCode: route.params.reportCode }),
            meta: {
              requiresAuth: true,
              requiresServerRoute: true,
              requiredDynamicPermission: 'rpt-query',
              title: '动态报表',
              useCaseKey: 'rpt/dynamic-report',
            },
          },
          {
            path: 'vou/sale-pricing',
            name: 'page:vou/sale-pricing',
            component: vouPageComponents['sale-pricing'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/sale-pricing/query',
              title: '销售定价单',
              useCaseKey: 'vou/sale-pricing',
            },
          },
          {
            path: 'vou/sale-order',
            name: 'page:vou/sale-order',
            component: vouPageComponents['sale-order'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/sale-order/query',
              title: '销售订单',
              useCaseKey: 'vou/sale-order',
            },
          },
          {
            path: 'vou/sale-outbound',
            name: 'page:vou/sale-outbound',
            component: vouPageComponents['sale-outbound'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/sale-outbound/query',
              title: '销售出库单',
              useCaseKey: 'vou/sale-outbound',
            },
          },
          {
            path: 'vou/sale-delivery',
            name: 'page:vou/sale-delivery',
            component: vouPageComponents['sale-delivery'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/sale-delivery/query',
              title: '销售送货单',
              useCaseKey: 'vou/sale-delivery',
            },
          },
          {
            path: 'vou/sale-signoff',
            name: 'page:vou/sale-signoff',
            component: vouPageComponents['sale-signoff'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/sale-signoff/query',
              title: '销售签收单',
              useCaseKey: 'vou/sale-signoff',
            },
          },
          {
            path: 'vou/sale-return',
            name: 'page:vou/sale-return',
            component: vouPageComponents['sale-return'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/sale-return/query',
              title: '销售退货单',
              useCaseKey: 'vou/sale-return',
            },
          },
          {
            path: 'vou/purchase-order',
            name: 'page:vou/purchase-order',
            component: vouPageComponents['purchase-order'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/purchase-order/query',
              title: '采购订单',
              useCaseKey: 'vou/purchase-order',
            },
          },
          {
            path: 'vou/purchase-inbound',
            name: 'page:vou/purchase-inbound',
            component: vouPageComponents['purchase-inbound'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/purchase-inbound/query',
              title: '采购入库单',
              useCaseKey: 'vou/purchase-inbound',
            },
          },
          {
            path: 'vou/purchase-return',
            name: 'page:vou/purchase-return',
            component: vouPageComponents['purchase-return'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/purchase-return/query',
              title: '采购退货单',
              useCaseKey: 'vou/purchase-return',
            },
          },
          {
            path: 'vou/purchase-inquiry',
            name: 'page:vou/purchase-inquiry',
            component: vouPageComponents['purchase-inquiry'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/purchase-inquiry/query',
              title: '采购询价单',
              useCaseKey: 'vou/purchase-inquiry',
            },
          },
          {
            path: 'vou/order-production',
            name: 'page:vou/order-production',
            component: vouPageComponents['order-production'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/order-production/query',
              title: '生产配货单',
              useCaseKey: 'vou/order-production',
            },
          },
          {
            path: 'vou/self-production',
            name: 'page:vou/self-production',
            component: vouPageComponents['self-production'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/self-production/query',
              title: '生产自制品单',
              useCaseKey: 'vou/self-production',
            },
          },
          {
            path: 'vou/inventory-count',
            name: 'page:vou/inventory-count',
            component: vouPageComponents['inventory-count'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/inventory-count/query',
              title: '库存盘点单',
              useCaseKey: 'vou/inventory-count',
            },
          },
          {
            path: 'vou/sales-receipt',
            name: 'page:vou/sales-receipt',
            component: vouPageComponents['sales-receipt'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/sales-receipt/query',
              title: '销售收款单',
              useCaseKey: 'vou/sales-receipt',
            },
          },
          {
            path: 'vou/purchase-refund',
            name: 'page:vou/purchase-refund',
            component: vouPageComponents['purchase-refund'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/purchase-refund/query',
              title: '采购退款单',
              useCaseKey: 'vou/purchase-refund',
            },
          },
          {
            path: 'vou/other-receipt',
            name: 'page:vou/other-receipt',
            component: vouPageComponents['other-receipt'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/other-receipt/query',
              title: '其他收款单',
              useCaseKey: 'vou/other-receipt',
            },
          },
          {
            path: 'vou/sales-refund',
            name: 'page:vou/sales-refund',
            component: vouPageComponents['sales-refund'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/sales-refund/query',
              title: '销售退款单',
              useCaseKey: 'vou/sales-refund',
            },
          },
          {
            path: 'vou/purchase-payment',
            name: 'page:vou/purchase-payment',
            component: vouPageComponents['purchase-payment'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/purchase-payment/query',
              title: '采购付款单',
              useCaseKey: 'vou/purchase-payment',
            },
          },
          {
            path: 'vou/other-payment',
            name: 'page:vou/other-payment',
            component: vouPageComponents['other-payment'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/other-payment/query',
              title: '其他付款单',
              useCaseKey: 'vou/other-payment',
            },
          },
          {
            path: 'vou/employee-loan',
            name: 'page:vou/employee-loan',
            component: vouPageComponents['employee-loan'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/employee-loan/query',
              title: '员工借款单',
              useCaseKey: 'vou/employee-loan',
            },
          },
          {
            path: 'vou/employee-repayment',
            name: 'page:vou/employee-repayment',
            component: vouPageComponents['employee-repayment'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/employee-repayment/query',
              title: '员工还款单',
              useCaseKey: 'vou/employee-repayment',
            },
          },
          {
            path: 'vou/employee-loan-writeoff',
            name: 'page:vou/employee-loan-writeoff',
            component: vouPageComponents['employee-loan-writeoff'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/employee-loan-writeoff/query',
              title: '员工借款核销单',
              useCaseKey: 'vou/employee-loan-writeoff',
            },
          },
          {
            path: 'vou/expense-reimbursement',
            name: 'page:vou/expense-reimbursement',
            component: vouPageComponents['expense-reimbursement'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/expense-reimbursement/query',
              title: '费用报销单',
              useCaseKey: 'vou/expense-reimbursement',
            },
          },
          {
            path: 'vou/expense-payment',
            name: 'page:vou/expense-payment',
            component: vouPageComponents['expense-payment'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/expense-payment/query',
              title: '费用付款单',
              useCaseKey: 'vou/expense-payment',
            },
          },
          {
            path: 'vou/other-income',
            name: 'page:vou/other-income',
            component: vouPageComponents['other-income'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/other-income/query',
              title: '其他收入单',
              useCaseKey: 'vou/other-income',
            },
          },
          {
            path: 'vou/asset-acquisition',
            name: 'page:vou/asset-acquisition',
            component: vouPageComponents['asset-acquisition'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/asset-acquisition/query',
              title: '资产购置单',
              useCaseKey: 'vou/asset-acquisition',
            },
          },
          {
            path: 'vou/asset-sale',
            name: 'page:vou/asset-sale',
            component: vouPageComponents['asset-sale'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/asset-sale/query',
              title: '资产出售单',
              useCaseKey: 'vou/asset-sale',
            },
          },
          {
            path: 'vou/asset-liquidation',
            name: 'page:vou/asset-liquidation',
            component: vouPageComponents['asset-liquidation'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/asset-liquidation/query',
              title: '资产清理单',
              useCaseKey: 'vou/asset-liquidation',
            },
          },
          {
            path: 'vou/bill-receipt',
            name: 'page:vou/bill-receipt',
            component: vouPageComponents['bill-receipt'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/bill-receipt/query',
              title: '收票单',
              useCaseKey: 'vou/bill-receipt',
            },
          },
          {
            path: 'vou/bill-payment',
            name: 'page:vou/bill-payment',
            component: vouPageComponents['bill-payment'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/bill-payment/query',
              title: '付票单',
              useCaseKey: 'vou/bill-payment',
            },
          },
          {
            path: 'vou/bill-issue',
            name: 'page:vou/bill-issue',
            component: vouPageComponents['bill-issue'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/bill-issue/query',
              title: '开票单',
              useCaseKey: 'vou/bill-issue',
            },
          },
          {
            path: 'vou/bill-discount',
            name: 'page:vou/bill-discount',
            component: vouPageComponents['bill-discount'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/bill-discount/query',
              title: '票据贴现单',
              useCaseKey: 'vou/bill-discount',
            },
          },
          {
            path: 'vou/bill-maturity',
            name: 'page:vou/bill-maturity',
            component: vouPageComponents['bill-maturity'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/bill-maturity/query',
              title: '票据到期单',
              useCaseKey: 'vou/bill-maturity',
            },
          },
          {
            path: 'vou/intermediary-calculation',
            name: 'page:vou/intermediary-calculation',
            component: vouPageComponents['intermediary-calculation'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/intermediary-calculation/query',
              title: '居间计算单',
              useCaseKey: 'vou/intermediary-calculation',
            },
          },
          {
            path: 'vou/service-contract',
            name: 'page:vou/service-contract',
            component: vouPageComponents['service-contract'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/service-contract/query',
              title: '服务合同',
              useCaseKey: 'vou/service-contract',
            },
          },
          {
            path: 'vou/service-acceptance',
            name: 'page:vou/service-acceptance',
            component: vouPageComponents['service-acceptance'],
            meta: {
              requiresAuth: true,
              requiredPermission: '/vou/service-acceptance/query',
              title: '履约验收单',
              useCaseKey: 'vou/service-acceptance',
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
