# 页面用例覆盖率

<!-- 此文件由 `pnpm docs:coverage` 生成，请勿手工编辑。 -->

数据来源：[`frontend/src/router/registry.ts`](../../frontend/src/router/registry.ts) 与本目录下按 `<domain>/<entity>.md` 命名的页面用例。

- 已注册：62
- 已文档化：4
- 缺少用例：58

## RPT

| 页面         | 路由              | 状态     |
| ------------ | ----------------- | -------- |
| 报表定义管理 | `/rpt/definition` | 缺少用例 |

## ACC

| 页面         | 路由           | 状态     |
| ------------ | -------------- | -------- |
| 会计账簿     | `/acc/book`    | 缺少用例 |
| 会计科目     | `/acc/subject` | 缺少用例 |
| 账簿期初     | `/acc/opening` | 缺少用例 |
| VOU 会计映射 | `/acc/mapping` | 缺少用例 |
| 会计期间     | `/acc/period`  | 缺少用例 |

## BOB

| 页面         | 路由                    | 状态                        |
| ------------ | ----------------------- | --------------------------- |
| 客户         | `/bob/customer`         | [已文档化](bob/customer.md) |
| 供应商       | `/bob/supplier`         | [已文档化](bob/supplier.md) |
| 其他往来单位 | `/bob/other-party`      | 缺少用例                    |
| 员工         | `/bob/employee`         | 缺少用例                    |
| 产品         | `/bob/product`          | 缺少用例                    |
| 服务         | `/bob/service`          | 缺少用例                    |
| 仓库         | `/bob/warehouse`        | 缺少用例                    |
| 车辆         | `/bob/vehicle`          | 缺少用例                    |
| 资金账户     | `/bob/fund-account`     | 缺少用例                    |
| 经营主体     | `/bob/operating-entity` | 缺少用例                    |

## AUX

| 页面     | 路由                       | 状态     |
| -------- | -------------------------- | -------- |
| 结算方式 | `/aux/settlement-method`   | 缺少用例 |
| 收款方式 | `/aux/payment-method`      | 缺少用例 |
| 资产类别 | `/aux/asset-category`      | 缺少用例 |
| 产品分类 | `/aux/product-category`    | 缺少用例 |
| 部门     | `/aux/department`          | 缺少用例 |
| 岗位     | `/aux/position`            | 缺少用例 |
| 计量单位 | `/aux/measurement-unit`    | 缺少用例 |
| 字典类型 | `/aux/dictionary-type`     | 缺少用例 |
| 字典项   | `/aux/dictionary-item`     | 缺少用例 |
| 收支类型 | `/aux/income-expense-type` | 缺少用例 |

## VOU

| 页面         | 路由                            | 状态     |
| ------------ | ------------------------------- | -------- |
| 票据收入     | `/vou/bill-receipt`             | 缺少用例 |
| 票据付出     | `/vou/bill-payment`             | 缺少用例 |
| 票据开出     | `/vou/bill-issue`               | 缺少用例 |
| 票据贴现     | `/vou/bill-discount`            | 缺少用例 |
| 票据到期处理 | `/vou/bill-maturity`            | 缺少用例 |
| 销售定价     | `/vou/sale-pricing`             | 缺少用例 |
| 销售订单     | `/vou/sale-order`               | 缺少用例 |
| 销售出库     | `/vou/sale-outbound`            | 缺少用例 |
| 销售送货     | `/vou/sale-delivery`            | 缺少用例 |
| 销售签收     | `/vou/sale-signoff`             | 缺少用例 |
| 销售退货     | `/vou/sale-return`              | 缺少用例 |
| 居间计算单   | `/vou/intermediary-calculation` | 缺少用例 |
| 生产配货     | `/vou/order-production`         | 缺少用例 |
| 生产自制品   | `/vou/self-production`          | 缺少用例 |
| 库存盘点     | `/vou/inventory-count`          | 缺少用例 |
| 采购询价     | `/vou/purchase-inquiry`         | 缺少用例 |
| 采购订单     | `/vou/purchase-order`           | 缺少用例 |
| 采购入库     | `/vou/purchase-inbound`         | 缺少用例 |
| 采购退货     | `/vou/purchase-return`          | 缺少用例 |
| 销售收款     | `/vou/sales-receipt`            | 缺少用例 |
| 采购退款     | `/vou/purchase-refund`          | 缺少用例 |
| 其他往来收款 | `/vou/other-receipt`            | 缺少用例 |
| 销售退款     | `/vou/sales-refund`             | 缺少用例 |
| 采购付款     | `/vou/purchase-payment`         | 缺少用例 |
| 其他往来付款 | `/vou/other-payment`            | 缺少用例 |
| 费用报销     | `/vou/expense-reimbursement`    | 缺少用例 |
| 员工借款     | `/vou/employee-loan`            | 缺少用例 |
| 员工还款     | `/vou/employee-repayment`       | 缺少用例 |
| 员工借款核销 | `/vou/employee-loan-writeoff`   | 缺少用例 |
| 费用付款     | `/vou/expense-payment`          | 缺少用例 |
| 其他收入     | `/vou/other-income`             | 缺少用例 |
| 资产购置     | `/vou/asset-acquisition`        | 缺少用例 |
| 资产出让     | `/vou/asset-sale`               | 缺少用例 |
| 资产清算     | `/vou/asset-liquidation`        | 缺少用例 |

## WFL

| 页面     | 路由                      | 状态                                  |
| -------- | ------------------------- | ------------------------------------- |
| 流程定义 | `/wfl/process-definition` | [已文档化](wfl/process-definition.md) |
| 流程实例 | `/wfl/process-instance`   | [已文档化](wfl/process-instance.md)   |
