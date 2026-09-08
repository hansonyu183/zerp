# #403 共享单据目录验收

## 范围

以唯一共享单据目录为清单来源，全部既有 36 类单据由真实菜单进入独立 VouListPage。领域规则见 [VOU](../domains/vou.md#单据列表与详情)，页面编排见[目录列表](../use-cases/vou/catalog.md)。本记录不表示合并或部署；会计期初另票加入。

默认列统一为单号、经办人、业务日期、相对方、审批状态、金额、操作。基础条件为期间、单号、提交日期和审批状态。下表逐项列出扩展；全部类型使用自身精确权限前缀，query/get/approve/reject/unreject/unapprove/audit-history/attachment-read 各自鉴权，页面审批动作与服务端资格相交。既有 API 的 delete 与人工类型 submit-new/submit-change 仍在，页面专用编辑器、克隆及删除交互未实施，无伪回调。

| 类型 / 菜单                             | 扩展条件               | 金额摘要            | 人工新建资格         | 权限前缀                       | 详情 / 编辑 / 审批             |
| --------------------------------------- | ---------------------- | ------------------- | -------------------- | ------------------------------ | ------------------------------ |
| 销售定价单 · sale-pricing               | 无                     | —（无列表合计口径） | 领域允许，页面未实施 | /vou/sale-pricing/             | 只读快照 / 未实施 / 服务端资格 |
| 销售订单 · sale-order                   | 客户子单位、仓库名称   | 订单产品行合计      | 领域允许，页面未实施 | /vou/sale-order/               | 只读快照 / 未实施 / 服务端资格 |
| 销售出库单 · sale-outbound              | 无                     | —（无列表合计口径） | 系统生成，不允许     | /vou/sale-outbound/            | 只读快照 / 未实施 / 服务端资格 |
| 销售送货单 · sale-delivery              | 无                     | —（无列表合计口径） | 系统生成，不允许     | /vou/sale-delivery/            | 只读快照 / 未实施 / 服务端资格 |
| 销售签收单 · sale-signoff               | 相对方名称             | —（无列表合计口径） | 系统生成，不允许     | /vou/sale-signoff/             | 只读快照 / 未实施 / 服务端资格 |
| 销售退货单 · sale-return                | 仓库名称               | —（无列表合计口径） | 领域允许，页面未实施 | /vou/sale-return/              | 只读快照 / 未实施 / 服务端资格 |
| 采购订单 · purchase-order               | 供应商、仓库名称       | 订单产品行合计      | 领域允许，页面未实施 | /vou/purchase-order/           | 只读快照 / 未实施 / 服务端资格 |
| 采购入库单 · purchase-inbound           | 相对方名称、仓库名称   | —（无列表合计口径） | 领域允许，页面未实施 | /vou/purchase-inbound/         | 只读快照 / 未实施 / 服务端资格 |
| 采购退货单 · purchase-return            | 相对方名称、仓库名称   | —（无列表合计口径） | 领域允许，页面未实施 | /vou/purchase-return/          | 只读快照 / 未实施 / 服务端资格 |
| 采购询价单 · purchase-inquiry           | 相对方名称             | —（无列表合计口径） | 领域允许，页面未实施 | /vou/purchase-inquiry/         | 只读快照 / 未实施 / 服务端资格 |
| 生产配货单 · order-production           | 无                     | —（无列表合计口径） | 领域允许，页面未实施 | /vou/order-production/         | 只读快照 / 未实施 / 服务端资格 |
| 生产自制品单 · self-production          | 无                     | —（无列表合计口径） | 领域允许，页面未实施 | /vou/self-production/          | 只读快照 / 未实施 / 服务端资格 |
| 库存盘点单 · inventory-count            | 仓库名称               | —（无列表合计口径） | 领域允许，页面未实施 | /vou/inventory-count/          | 只读快照 / 未实施 / 服务端资格 |
| 销售收款单 · sales-receipt              | 相对方名称、经办人姓名 | 原币表头金额        | 领域允许，页面未实施 | /vou/sales-receipt/            | 只读快照 / 未实施 / 服务端资格 |
| 采购退款单 · purchase-refund            | 相对方名称、经办人姓名 | 原币表头金额        | 领域允许，页面未实施 | /vou/purchase-refund/          | 只读快照 / 未实施 / 服务端资格 |
| 其他收款单 · other-receipt              | 相对方名称、经办人姓名 | 原币表头金额        | 领域允许，页面未实施 | /vou/other-receipt/            | 只读快照 / 未实施 / 服务端资格 |
| 销售退款单 · sales-refund               | 相对方名称、经办人姓名 | 原币表头金额        | 领域允许，页面未实施 | /vou/sales-refund/             | 只读快照 / 未实施 / 服务端资格 |
| 采购付款单 · purchase-payment           | 相对方名称、经办人姓名 | 原币表头金额        | 领域允许，页面未实施 | /vou/purchase-payment/         | 只读快照 / 未实施 / 服务端资格 |
| 其他付款单 · other-payment              | 相对方名称、经办人姓名 | 原币表头金额        | 领域允许，页面未实施 | /vou/other-payment/            | 只读快照 / 未实施 / 服务端资格 |
| 员工借款单 · employee-loan              | 相对方名称、经办人姓名 | 原币表头金额        | 领域允许，页面未实施 | /vou/employee-loan/            | 只读快照 / 未实施 / 服务端资格 |
| 员工还款单 · employee-repayment         | 相对方名称、经办人姓名 | 原币表头金额        | 领域允许，页面未实施 | /vou/employee-repayment/       | 只读快照 / 未实施 / 服务端资格 |
| 员工借款核销单 · employee-loan-writeoff | 相对方名称             | —（无列表合计口径） | 领域允许，页面未实施 | /vou/employee-loan-writeoff/   | 只读快照 / 未实施 / 服务端资格 |
| 费用报销单 · expense-reimbursement      | 相对方名称             | —（无列表合计口径） | 领域允许，页面未实施 | /vou/expense-reimbursement/    | 只读快照 / 未实施 / 服务端资格 |
| 费用付款单 · expense-payment            | 相对方名称、经办人姓名 | 原币表头金额        | 系统生成，不允许     | /vou/expense-payment/          | 只读快照 / 未实施 / 服务端资格 |
| 其他收入单 · other-income               | 相对方名称、经办人姓名 | 原币表头金额        | 领域允许，页面未实施 | /vou/other-income/             | 只读快照 / 未实施 / 服务端资格 |
| 资产购置单 · asset-acquisition          | 相对方名称             | —（无列表合计口径） | 领域允许，页面未实施 | /vou/asset-acquisition/        | 只读快照 / 未实施 / 服务端资格 |
| 资产出售单 · asset-sale                 | 相对方名称             | —（无列表合计口径） | 领域允许，页面未实施 | /vou/asset-sale/               | 只读快照 / 未实施 / 服务端资格 |
| 资产清理单 · asset-liquidation          | 无                     | —（无列表合计口径） | 领域允许，页面未实施 | /vou/asset-liquidation/        | 只读快照 / 未实施 / 服务端资格 |
| 收票单 · bill-receipt                   | 相对方名称、经办人姓名 | —（无列表合计口径） | 领域允许，页面未实施 | /vou/bill-receipt/             | 只读快照 / 未实施 / 服务端资格 |
| 付票单 · bill-payment                   | 相对方名称、经办人姓名 | —（无列表合计口径） | 领域允许，页面未实施 | /vou/bill-payment/             | 只读快照 / 未实施 / 服务端资格 |
| 开票单 · bill-issue                     | 相对方名称             | —（无列表合计口径） | 领域允许，页面未实施 | /vou/bill-issue/               | 只读快照 / 未实施 / 服务端资格 |
| 票据贴现单 · bill-discount              | 相对方名称             | —（无列表合计口径） | 领域允许，页面未实施 | /vou/bill-discount/            | 只读快照 / 未实施 / 服务端资格 |
| 票据到期单 · bill-maturity              | 无                     | —（无列表合计口径） | 领域允许，页面未实施 | /vou/bill-maturity/            | 只读快照 / 未实施 / 服务端资格 |
| 居间计算单 · intermediary-calculation   | 无                     | —（无列表合计口径） | 领域允许，页面未实施 | /vou/intermediary-calculation/ | 只读快照 / 未实施 / 服务端资格 |
| 服务合同 · service-contract             | 相对方名称             | —（无列表合计口径） | 领域允许，页面未实施 | /vou/service-contract/         | 只读快照 / 未实施 / 服务端资格 |
| 履约验收单 · service-acceptance         | 相对方名称             | —（无列表合计口径） | 领域允许，页面未实施 | /vou/service-acceptance/       | 只读快照 / 未实施 / 服务端资格 |

## 验证与边界

36 类由现有领域命令构造真实 PostgreSQL 提交事实，使用现有事务夹具回滚本次数据。系统生成类型使用领域可信系统入口；资产、票据等待批准的测试提交不表示已验证全部会计过账流程。没有 schema 修改或数据迁移，HTTP 契约生成采用分项命令，不调用会隐式清库的 Make 聚合入口。

- 分项 `generate:artifacts` 已完成，OpenAPI 新增三项名称筛选；无数据库结构生成物变化。
- 36 类真实 Hono HTTP query/get 验证通过：逐类合法与非法筛选、摘要边界、经办人事实、合法空值、资金金额分位、日期与历史名称。员工直接改名、往来单位批准新版本后，既有摘要和名称筛选仍保持采用时事实。
- 分项数据库回归 `vou-catalog`、`vou-orders`、`vou-core`、`vou-control` 共 8 项通过；覆盖目录内待批准单据的驳回/恢复审核、各种已提交状态可查询，以及已有审批并发、控制账簿、引用、附件与提交回滚。
- `pnpm --filter @zerp/api e2e:vou-catalog`：36 类菜单、筛选、打开完整快照及只审批权限不读取，两条浏览器场景通过；代表类型在 390px 验证页面无横向溢出。专用入口使用调用方已授权的 `TARGET_TEST_DATABASE_URL` 与 `TARGET_DATABASE_SCOPE`，沿用事务夹具，在本机临时 API/Web 上执行，自动关闭服务并回滚测试数据，不重建 schema。
- API/API client/model/frontend 类型检查、前端 lint 和生产构建通过。API 单元测试 80 项、生成工具测试 19 项、model 31 项、前端单元测试 210 项及 Vuetify 10 项通过；审查补充的外币及完整 AUX 采用快照组件回归通过。
- Standards 与 Spec 各发现一项详情展示问题（合法外币、嵌套采用快照），均已修正并补组件回归；独立复核两轴均无未解决问题。
- 票据、服务合同与履约验收日期改为数据库日期文本投影，避免时区转换成时间戳；资金摘要使用 numeric 除法保留分位。

本次直接使用用户授权的 `zerp` 数据库。未运行会清库的聚合入口、未变更 CI、未部署。浏览器缩放出现既有 ResizeObserver 通知诊断，但交互与宽度断言通过；生产构建有既有 chunk 大小提示。未重建专用编辑器或验收全部单据过账算法，范围内列表、只读详情与通用审批不因此省略。
