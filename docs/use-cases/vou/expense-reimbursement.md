# 费用报销单页面用例

## 范围

- 路由：`/vou/expense-reimbursement`，公共 Draft、查询、详情与生命周期编排见 [VOU 页面公共用例](README.md)。
- 业务不变量以 [VOU 领域文档](../../domains/vou.md#38-费用报销) 为准；请求与响应只采用可执行 Hono 路由。

## `VOU-EXPENSE-REIMBURSEMENT-01` 业务工作区

1. 选择报销员工并逐项登记费用类别、说明和金额。
2. 用户可新建本地 Draft，或从服务器详情建立变更 Draft；页面使用费用业务家族编辑器，字段变化保存到当前浏览器。
3. 新增与变更分别调用 `/vou/expense-reimbursement/submit-new`、`/vou/expense-reimbursement/submit-change`；失败保留 Draft，成功只删除本次 Draft。

## 验收

1. 列表固定每页 20 条，详情采用服务器 payload、revision、`availableApprovalActions` 和 `canDelete`。
2. 页面不显示 JSON 技术表单，不从描述器动态生成控件，不手输 Approval Entry。
3. 当前共享契约缺失的领域事实按公共用例的“当前契约缺口”披露，页面不以临时字段或前端推断补齐。
