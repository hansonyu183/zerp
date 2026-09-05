# 页面用例覆盖率

<!-- 此文件由 `pnpm docs:coverage` 生成，请勿手工编辑。 -->

数据来源：[`frontend/src/target/router/index.ts`](../../frontend/src/target/router/index.ts) 的带标题路由，以及本目录下按 `<domain>/<page>.md` 命名的页面用例。

统计口径：每个带 `meta.title` 的正式 target 路由必须声明 `meta.useCaseKey`；layout 与重定向不单独计数。

- 页面入口：80
- 已覆盖入口：80
- 已登记用例：80
- 缺少用例：0
- 孤儿用例：0

## APP

| 页面       | 路由                    | 来源                                                  | 状态                                |
| ---------- | ----------------------- | ----------------------------------------------------- | ----------------------------------- |
| 登录       | `/signin`               | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](app/signin.md)           |
| 修改密码   | `/change-password`      | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](app/change-password.md)  |
| 工作台     | `/home/dashboard`       | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](app/dashboard.md)        |
| 用户管理   | `/app/user`             | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](app/user.md)             |
| 角色管理   | `/app/role`             | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](app/role.md)             |
| 权限目录   | `/app/permission`       | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](app/permission.md)       |
| 系统参数   | `/app/system-parameter` | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](app/system-parameter.md) |
| 菜单管理   | `/app/menu`             | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](app/menu.md)             |
| 无权访问   | `/forbidden`            | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](app/forbidden.md)        |
| 页面不存在 | `/:pathMatch(.*)*`      | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](app/not-found.md)        |

## AUX

| 页面     | 路由                       | 来源                                                  | 状态                                   |
| -------- | -------------------------- | ----------------------------------------------------- | -------------------------------------- |
| 产品分类 | `/aux/product-category`    | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](aux/product-category.md)    |
| 产品类型 | `/aux/product-type`        | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](aux/product-type.md)        |
| 员工分类 | `/aux/employee-category`   | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](aux/employee-category.md)   |
| 部门     | `/aux/department`          | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](aux/department.md)          |
| 岗位     | `/aux/position`            | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](aux/position.md)            |
| 结算方式 | `/aux/settlement-method`   | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](aux/settlement-method.md)   |
| 收款方式 | `/aux/payment-method`      | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](aux/payment-method.md)      |
| 字典类型 | `/aux/dictionary-type`     | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](aux/dictionary-type.md)     |
| 字典项   | `/aux/dictionary-item`     | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](aux/dictionary-item.md)     |
| 计量单位 | `/aux/measurement-unit`    | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](aux/measurement-unit.md)    |
| 收支类型 | `/aux/income-expense-type` | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](aux/income-expense-type.md) |
| 资产分类 | `/aux/asset-category`      | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](aux/asset-category.md)      |

## DCL

| 页面           | 路由                          | 来源                                                  | 状态                                      |
| -------------- | ----------------------------- | ----------------------------------------------------- | ----------------------------------------- |
| 仓库申报       | `/dcl/warehouse`              | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](dcl/warehouse.md)              |
| 经营主体申报   | `/dcl/operating-entity`       | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](dcl/operating-entity.md)       |
| 车辆申报       | `/dcl/vehicle`                | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](dcl/vehicle.md)                |
| 资金账户申报   | `/dcl/fund-account`           | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](dcl/fund-account.md)           |
| 产品申报       | `/dcl/product`                | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](dcl/product.md)                |
| 员工申报       | `/dcl/employee`               | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](dcl/employee.md)               |
| 供应商申报     | `/dcl/supplier`               | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](dcl/supplier.md)               |
| 客户申报       | `/dcl/customer`               | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](dcl/customer.md)               |
| 其他单位申报   | `/dcl/other-unit`             | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](dcl/other-unit.md)             |
| 销售合作方申报 | `/dcl/sales-partner`          | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](dcl/sales-partner.md)          |
| 会计映射申报   | `/dcl/acc-mapping`            | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](dcl/acc-mapping.md)            |
| 报表定义申报   | `/dcl/rpt-definition`         | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](dcl/rpt-definition.md)         |
| 流程定义申报   | `/dcl/wfl-process-definition` | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](dcl/wfl-process-definition.md) |

## ACC

| 页面     | 路由           | 来源                                                  | 状态                       |
| -------- | -------------- | ----------------------------------------------------- | -------------------------- |
| 会计账簿 | `/acc/book`    | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](acc/book.md)    |
| 会计科目 | `/acc/subject` | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](acc/subject.md) |
| 会计映射 | `/acc/mapping` | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](acc/mapping.md) |
| 会计期初 | `/acc/opening` | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](acc/opening.md) |
| 会计期间 | `/acc/period`  | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](acc/period.md)  |

## WFL

| 页面     | 路由                      | 来源                                                  | 状态                                  |
| -------- | ------------------------- | ----------------------------------------------------- | ------------------------------------- |
| 流程定义 | `/wfl/process-definition` | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](wfl/process-definition.md) |
| 流程实例 | `/wfl/process-instance`   | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](wfl/process-instance.md)   |
| 业务流程 | `/wfl/:processCode`       | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](wfl/dynamic-process.md)    |

## RPT

| 页面     | 路由               | 来源                                                  | 状态                              |
| -------- | ------------------ | ----------------------------------------------------- | --------------------------------- |
| 动态报表 | `/rpt/:reportCode` | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](rpt/dynamic-report.md) |

## VOU

| 页面           | 路由                            | 来源                                                  | 状态                                        |
| -------------- | ------------------------------- | ----------------------------------------------------- | ------------------------------------------- |
| 销售定价单     | `/vou/sale-pricing`             | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/sale-pricing.md)             |
| 销售订单       | `/vou/sale-order`               | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/sale-order.md)               |
| 销售出库单     | `/vou/sale-outbound`            | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/sale-outbound.md)            |
| 销售送货单     | `/vou/sale-delivery`            | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/sale-delivery.md)            |
| 销售签收单     | `/vou/sale-signoff`             | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/sale-signoff.md)             |
| 销售退货单     | `/vou/sale-return`              | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/sale-return.md)              |
| 采购订单       | `/vou/purchase-order`           | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/purchase-order.md)           |
| 采购入库单     | `/vou/purchase-inbound`         | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/purchase-inbound.md)         |
| 采购退货单     | `/vou/purchase-return`          | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/purchase-return.md)          |
| 采购询价单     | `/vou/purchase-inquiry`         | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/purchase-inquiry.md)         |
| 生产配货单     | `/vou/order-production`         | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/order-production.md)         |
| 生产自制品单   | `/vou/self-production`          | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/self-production.md)          |
| 库存盘点单     | `/vou/inventory-count`          | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/inventory-count.md)          |
| 销售收款单     | `/vou/sales-receipt`            | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/sales-receipt.md)            |
| 采购退款单     | `/vou/purchase-refund`          | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/purchase-refund.md)          |
| 其他收款单     | `/vou/other-receipt`            | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/other-receipt.md)            |
| 销售退款单     | `/vou/sales-refund`             | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/sales-refund.md)             |
| 采购付款单     | `/vou/purchase-payment`         | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/purchase-payment.md)         |
| 其他付款单     | `/vou/other-payment`            | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/other-payment.md)            |
| 员工借款单     | `/vou/employee-loan`            | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/employee-loan.md)            |
| 员工还款单     | `/vou/employee-repayment`       | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/employee-repayment.md)       |
| 员工借款核销单 | `/vou/employee-loan-writeoff`   | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/employee-loan-writeoff.md)   |
| 费用报销单     | `/vou/expense-reimbursement`    | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/expense-reimbursement.md)    |
| 费用付款单     | `/vou/expense-payment`          | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/expense-payment.md)          |
| 其他收入单     | `/vou/other-income`             | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/other-income.md)             |
| 资产购置单     | `/vou/asset-acquisition`        | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/asset-acquisition.md)        |
| 资产出售单     | `/vou/asset-sale`               | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/asset-sale.md)               |
| 资产清理单     | `/vou/asset-liquidation`        | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/asset-liquidation.md)        |
| 收票单         | `/vou/bill-receipt`             | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/bill-receipt.md)             |
| 付票单         | `/vou/bill-payment`             | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/bill-payment.md)             |
| 开票单         | `/vou/bill-issue`               | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/bill-issue.md)               |
| 票据贴现单     | `/vou/bill-discount`            | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/bill-discount.md)            |
| 票据到期单     | `/vou/bill-maturity`            | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/bill-maturity.md)            |
| 居间计算单     | `/vou/intermediary-calculation` | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/intermediary-calculation.md) |
| 服务合同       | `/vou/service-contract`         | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/service-contract.md)         |
| 履约验收单     | `/vou/service-acceptance`       | [目标路由](../../frontend/src/target/router/index.ts) | [已文档化](vou/service-acceptance.md)       |
