# 页面用例

本目录按用户可见页面记录前端编排、后端协作次序、异常分支和验收场景。业务规则仍以 [`docs/domains/`](../domains/) 为唯一事实来源，HTTP 路径和数据结构仍以 [`contracts/openapi/`](../../contracts/openapi/) 为唯一事实来源。

用例文档遵循以下边界：

- 一个页面一份文档；跨页面流程归入用户发起或主要感知该流程的页面；
- 只描述触发条件、前端状态与跳转、调用顺序、后端协作和可观察结果；
- 通过链接引用领域不变量、状态转换、权限和事务规则，不复制其正文；
- 通过链接引用 OpenAPI，不维护请求或响应结构副本；
- 全站通用交互规范写入 [`frontend/AGENTS.md`](../../frontend/AGENTS.md)，页面文档只记录有业务含义的例外。

全站列表、详情和引用候选的读取边界见 [`frontend/AGENTS.md`](../../frontend/AGENTS.md)。

## APP

- [登录页](app/signin.md)
- [工作台](app/workbench.md)
- [用户管理](app/user-management.md)
- [角色管理](app/role-management.md)
- [权限管理](app/permission-management.md)
- [系统参数](app/system-parameter-management.md)
- [菜单管理](app/menu-management.md)

## BOB

- [客户](bob/customer.md)

## WFL

- [流程定义](wfl/process-definition.md)
- [流程实例](wfl/process-instance.md)

## 待讨论

以下清单以当前前端已注册、但尚无权威用例文档的用户可见业务页面为边界。完成一项讨论后，在对应领域目录新增页面文档，并将该项从本节移动到上方的领域索引；不得同时保留已完成链接和待办项。登录页用例已经包含首次强制改密流程，系统错误页和未注册实体的“开发中”占位页不单独进入讨论清单。动态报表统一复用同一页面，其公共查询、钻取和导出编排只讨论一次，不按报表编码重复拆分。

### BOB

- [ ] 供应商（`/bob/supplier`）
- [ ] 其他往来单位（`/bob/other-party`）
- [ ] 员工（`/bob/employee`）
- [ ] 产品（`/bob/product`）
- [ ] 服务（`/bob/service`）
- [ ] 仓库（`/bob/warehouse`）
- [ ] 车辆（`/bob/vehicle`）
- [ ] 资金账户（`/bob/fund-account`）
- [ ] 经营主体（`/bob/operating-entity`）

### AUX

- [ ] 结算方式（`/aux/settlement-method`）
- [ ] 收款方式（`/aux/payment-method`）
- [ ] 资产类别（`/aux/asset-category`）
- [ ] 产品分类（`/aux/product-category`）
- [ ] 部门（`/aux/department`）
- [ ] 岗位（`/aux/position`）
- [ ] 计量单位（`/aux/measurement-unit`）
- [ ] 字典类型（`/aux/dictionary-type`）
- [ ] 字典项（`/aux/dictionary-item`）
- [ ] 收支类型（`/aux/income-expense-type`）

### VOU

- [ ] 销售定价（`/vou/sale-pricing`）
- [ ] 销售订单（`/vou/sale-order`）
- [ ] 销售出库（`/vou/sale-outbound`）
- [ ] 销售送货（`/vou/sale-delivery`）
- [ ] 销售签收（`/vou/sale-signoff`）
- [ ] 销售退货（`/vou/sale-return`）
- [ ] 居间计算单（`/vou/intermediary-calculation`）
- [ ] 生产配货（`/vou/order-production`）
- [ ] 生产自制品（`/vou/self-production`）
- [ ] 库存盘点（`/vou/inventory-count`）
- [ ] 采购询价（`/vou/purchase-inquiry`）
- [ ] 采购订单（`/vou/purchase-order`）
- [ ] 采购入库（`/vou/purchase-inbound`）
- [ ] 采购退货（`/vou/purchase-return`）
- [ ] 销售收款（`/vou/sales-receipt`）
- [ ] 销售退款（`/vou/sales-refund`）
- [ ] 采购付款（`/vou/purchase-payment`）
- [ ] 采购退款（`/vou/purchase-refund`）
- [ ] 其他往来收款（`/vou/other-receipt`）
- [ ] 其他往来付款（`/vou/other-payment`）
- [ ] 员工借款（`/vou/employee-loan`）
- [ ] 员工还款（`/vou/employee-repayment`）
- [ ] 员工借款核销（`/vou/employee-loan-writeoff`）
- [ ] 费用报销（`/vou/expense-reimbursement`）
- [ ] 费用付款（`/vou/expense-payment`）
- [ ] 其他收入（`/vou/other-income`）
- [ ] 资产购置（`/vou/asset-acquisition`）
- [ ] 资产出让（`/vou/asset-sale`）
- [ ] 资产清算（`/vou/asset-liquidation`）
- [ ] 票据收入（`/vou/bill-receipt`）
- [ ] 票据付出（`/vou/bill-payment`）
- [ ] 票据开出（`/vou/bill-issue`）
- [ ] 票据贴现（`/vou/bill-discount`）
- [ ] 票据到期处理（`/vou/bill-maturity`）

### ACC

- [ ] 会计账簿（`/acc/book`）
- [ ] 会计科目（`/acc/subject`）
- [ ] 账簿期初（`/acc/opening`）
- [ ] VOU 会计映射（`/acc/mapping`）
- [ ] 会计期间（`/acc/period`）

### RPT

- [ ] 报表定义管理（`/rpt/definition`）
- [ ] 报表查询与导出（动态路由 `/rpt/{reportCode}`）
