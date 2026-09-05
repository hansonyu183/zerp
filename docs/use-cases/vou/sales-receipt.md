# 销售收款单页面用例

## 范围

- 路由：`/vou/sales-receipt`，公共 Draft、查询、详情与生命周期编排见 [VOU 页面公共用例](README.md)。
- 业务不变量以 [VOU 领域文档](../../domains/vou.md#36-往来收款与往来付款) 为准；请求与响应只采用可执行 Hono 路由。

## `VOU-SALES-RECEIPT-01` 业务工作区

1. 选择客户、经营主体、资金账户和经办人，并按客户子户分配收款金额。
2. 用户可新建本地 Draft，或从服务器详情建立变更 Draft；页面使用资金业务家族编辑器，字段变化保存到当前浏览器。
3. 新增与变更分别调用 `/vou/sales-receipt/submit-new`、`/vou/sales-receipt/submit-change`；失败保留 Draft，成功只删除本次 Draft。

## 验收

1. 列表固定每页 20 条，详情采用服务器 payload、revision、`availableApprovalActions` 和 `canDelete`。
2. 页面不显示 JSON 技术表单，不从描述器动态生成控件，不手输 Approval Entry。
3. 当前共享契约缺失的领域事实按公共用例的“当前契约缺口”披露，页面不以临时字段或前端推断补齐。
