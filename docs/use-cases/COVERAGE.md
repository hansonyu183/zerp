# 页面用例覆盖率

<!-- 此文件由 `pnpm docs:coverage` 生成，请勿手工编辑。 -->

数据来源：[`frontend/src/router/registry.ts`](../../frontend/src/router/registry.ts)、[`frontend/src/router/index.ts`](../../frontend/src/router/index.ts)，以及本目录下按 `<domain>/<page>.md` 命名的页面用例。

- 页面入口：91
- 已覆盖入口：40
- 已登记用例：39
- 缺少用例：51
- 孤儿用例：0

## APP

| 页面     | 路由                    | 来源                                           | 状态                                           |
| -------- | ----------------------- | ---------------------------------------------- | ---------------------------------------------- |
| 登录     | `/signin`               | [静态路由](../../frontend/src/router/index.ts) | [已文档化](app/signin.md)                      |
| 修改密码 | `/change-password`      | [静态路由](../../frontend/src/router/index.ts) | [已文档化](app/signin.md)                      |
| 工作台   | `/home/dashboard`       | [静态路由](../../frontend/src/router/index.ts) | [已文档化](app/workbench.md)                   |
| 用户管理 | `/app/user`             | [静态路由](../../frontend/src/router/index.ts) | [已文档化](app/user-management.md)             |
| 角色管理 | `/app/role`             | [静态路由](../../frontend/src/router/index.ts) | [已文档化](app/role-management.md)             |
| 权限管理 | `/app/permission`       | [静态路由](../../frontend/src/router/index.ts) | [已文档化](app/permission-management.md)       |
| 系统参数 | `/app/system-parameter` | [静态路由](../../frontend/src/router/index.ts) | [已文档化](app/system-parameter-management.md) |
| 菜单管理 | `/app/menu`             | [静态路由](../../frontend/src/router/index.ts) | [已文档化](app/menu-management.md)             |

## DCL

| 页面               | 路由                          | 来源                                                | 状态                                      |
| ------------------ | ----------------------------- | --------------------------------------------------- | ----------------------------------------- |
| 主体申报           | `/dcl/party`                  | [页面注册表](../../frontend/src/router/registry.ts) | [已文档化](dcl/party.md)                  |
| 经营主体申报       | `/dcl/operating-entity`       | [页面注册表](../../frontend/src/router/registry.ts) | [已文档化](dcl/operating-entity.md)       |
| 仓库申报           | `/dcl/warehouse`              | [页面注册表](../../frontend/src/router/registry.ts) | [已文档化](dcl/warehouse.md)              |
| 车辆申报           | `/dcl/vehicle`                | [页面注册表](../../frontend/src/router/registry.ts) | [已文档化](dcl/vehicle.md)                |
| 资金账户申报       | `/dcl/fund-account`           | [页面注册表](../../frontend/src/router/registry.ts) | [已文档化](dcl/fund-account.md)           |
| 人员申报           | `/dcl/employee`               | [页面注册表](../../frontend/src/router/registry.ts) | [已文档化](dcl/employee.md)               |
| 其他单位申报       | `/dcl/other-unit`             | [页面注册表](../../frontend/src/router/registry.ts) | [已文档化](dcl/other-unit.md)             |
| 销售合作方申报     | `/dcl/sales-partner`          | [页面注册表](../../frontend/src/router/registry.ts) | [已文档化](dcl/sales-partner.md)          |
| 客户申报           | `/dcl/customer`               | [页面注册表](../../frontend/src/router/registry.ts) | [已文档化](dcl/customer.md)               |
| 客户结算子账户申报 | `/dcl/customer-account`       | [页面注册表](../../frontend/src/router/registry.ts) | [已文档化](dcl/customer-account.md)       |
| 供应商申报         | `/dcl/supplier`               | [页面注册表](../../frontend/src/router/registry.ts) | [已文档化](dcl/supplier.md)               |
| 产品申报           | `/dcl/product`                | [页面注册表](../../frontend/src/router/registry.ts) | [已文档化](dcl/product.md)                |
| 会计映射申报       | `/dcl/acc-mapping`            | [页面注册表](../../frontend/src/router/registry.ts) | [已文档化](dcl/acc-mapping.md)            |
| 报表定义申报       | `/dcl/rpt-definition`         | [页面注册表](../../frontend/src/router/registry.ts) | [已文档化](dcl/rpt-definition.md)         |
| 流程定义申报       | `/dcl/wfl-process-definition` | [页面注册表](../../frontend/src/router/registry.ts) | [已文档化](dcl/wfl-process-definition.md) |

## ACC

| 页面              | 路由           | 来源                                                | 状态     |
| ----------------- | -------------- | --------------------------------------------------- | -------- |
| 会计账簿          | `/acc/book`    | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例 |
| 会计科目          | `/acc/subject` | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例 |
| 账簿期初          | `/acc/opening` | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例 |
| 当前 VOU 会计映射 | `/acc/mapping` | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例 |
| 会计期间          | `/acc/period`  | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例 |

## BOB

| 页面                     | 路由                    | 来源                                                | 状态                                |
| ------------------------ | ----------------------- | --------------------------------------------------- | ----------------------------------- |
| 主体                     | `/bob/party`            | [页面注册表](../../frontend/src/router/registry.ts) | [已文档化](bob/party.md)            |
| 客户结算子账户           | `/bob/customer-account` | [页面注册表](../../frontend/src/router/registry.ts) | [已文档化](bob/customer-account.md) |
| 客户                     | `/bob/customer`         | [页面注册表](../../frontend/src/router/registry.ts) | [已文档化](bob/customer.md)         |
| 供应商                   | `/bob/supplier`         | [页面注册表](../../frontend/src/router/registry.ts) | [已文档化](bob/supplier.md)         |
| 其他单位                 | `/bob/other-unit`       | [页面注册表](../../frontend/src/router/registry.ts) | [已文档化](bob/other-unit.md)       |
| 销售合作方               | `/bob/sales-partner`    | [页面注册表](../../frontend/src/router/registry.ts) | [已文档化](bob/sales-partner.md)    |
| 员工                     | `/bob/employee`         | [页面注册表](../../frontend/src/router/registry.ts) | [已文档化](bob/employee.md)         |
| 产品（当前有效资料）     | `/bob/product`          | [页面注册表](../../frontend/src/router/registry.ts) | [已文档化](bob/product.md)          |
| 仓库                     | `/bob/warehouse`        | [页面注册表](../../frontend/src/router/registry.ts) | [已文档化](bob/warehouse.md)        |
| 车辆                     | `/bob/vehicle`          | [页面注册表](../../frontend/src/router/registry.ts) | [已文档化](bob/vehicle.md)          |
| 资金账户（当前有效资料） | `/bob/fund-account`     | [页面注册表](../../frontend/src/router/registry.ts) | [已文档化](bob/fund-account.md)     |
| 经营主体                 | `/bob/operating-entity` | [页面注册表](../../frontend/src/router/registry.ts) | [已文档化](bob/operating-entity.md) |

## AUX

| 页面     | 路由                       | 来源                                                | 状态                                 |
| -------- | -------------------------- | --------------------------------------------------- | ------------------------------------ |
| 结算方式 | `/aux/settlement-method`   | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                             |
| 收款方式 | `/aux/payment-method`      | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                             |
| 资产类别 | `/aux/asset-category`      | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                             |
| 产品分类 | `/aux/product-category`    | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                             |
| 产品类型 | `/aux/product-type`        | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                             |
| 部门     | `/aux/department`          | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                             |
| 人员类别 | `/aux/employee-category`   | [页面注册表](../../frontend/src/router/registry.ts) | [已文档化](aux/employee-category.md) |
| 岗位     | `/aux/position`            | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                             |
| 计量单位 | `/aux/measurement-unit`    | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                             |
| 字典类型 | `/aux/dictionary-type`     | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                             |
| 字典项   | `/aux/dictionary-item`     | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                             |
| 收支类型 | `/aux/income-expense-type` | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                             |

## VOU

| 页面         | 路由                            | 来源                                                | 状态                                  |
| ------------ | ------------------------------- | --------------------------------------------------- | ------------------------------------- |
| 票据收入     | `/vou/bill-receipt`             | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                              |
| 票据付出     | `/vou/bill-payment`             | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                              |
| 票据开出     | `/vou/bill-issue`               | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                              |
| 票据贴现     | `/vou/bill-discount`            | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                              |
| 票据到期处理 | `/vou/bill-maturity`            | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                              |
| 销售定价     | `/vou/sale-pricing`             | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                              |
| 销售订单     | `/vou/sale-order`               | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                              |
| 销售出库     | `/vou/sale-outbound`            | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                              |
| 销售送货     | `/vou/sale-delivery`            | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                              |
| 销售签收     | `/vou/sale-signoff`             | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                              |
| 销售退货     | `/vou/sale-return`              | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                              |
| 居间计算单   | `/vou/intermediary-calculation` | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                              |
| 服务合同     | `/vou/service-contract`         | [页面注册表](../../frontend/src/router/registry.ts) | [已文档化](vou/service-contract.md)   |
| 履约验收     | `/vou/service-acceptance`       | [页面注册表](../../frontend/src/router/registry.ts) | [已文档化](vou/service-acceptance.md) |
| 生产配货     | `/vou/order-production`         | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                              |
| 生产自制品   | `/vou/self-production`          | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                              |
| 库存盘点     | `/vou/inventory-count`          | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                              |
| 采购询价     | `/vou/purchase-inquiry`         | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                              |
| 采购订单     | `/vou/purchase-order`           | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                              |
| 采购入库     | `/vou/purchase-inbound`         | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                              |
| 采购退货     | `/vou/purchase-return`          | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                              |
| 销售收款     | `/vou/sales-receipt`            | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                              |
| 采购退款     | `/vou/purchase-refund`          | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                              |
| 其他往来收款 | `/vou/other-receipt`            | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                              |
| 销售退款     | `/vou/sales-refund`             | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                              |
| 采购付款     | `/vou/purchase-payment`         | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                              |
| 其他往来付款 | `/vou/other-payment`            | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                              |
| 费用报销     | `/vou/expense-reimbursement`    | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                              |
| 员工借款     | `/vou/employee-loan`            | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                              |
| 员工还款     | `/vou/employee-repayment`       | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                              |
| 员工借款核销 | `/vou/employee-loan-writeoff`   | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                              |
| 费用付款     | `/vou/expense-payment`          | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                              |
| 其他收入     | `/vou/other-income`             | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                              |
| 资产购置     | `/vou/asset-acquisition`        | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                              |
| 资产出让     | `/vou/asset-sale`               | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                              |
| 资产清算     | `/vou/asset-liquidation`        | [页面注册表](../../frontend/src/router/registry.ts) | 缺少用例                              |

## WFL

| 页面     | 路由                      | 来源                                                | 状态                                  |
| -------- | ------------------------- | --------------------------------------------------- | ------------------------------------- |
| 流程定义 | `/wfl/process-definition` | [页面注册表](../../frontend/src/router/registry.ts) | [已文档化](wfl/process-definition.md) |
| 流程实例 | `/wfl/process-instance`   | [页面注册表](../../frontend/src/router/registry.ts) | [已文档化](wfl/process-instance.md)   |

## RPT

| 页面     | 路由          | 来源                                              | 状态     |
| -------- | ------------- | ------------------------------------------------- | -------- |
| 动态报表 | `/rpt/{code}` | [动态路由](../../frontend/src/router/registry.ts) | 缺少用例 |
