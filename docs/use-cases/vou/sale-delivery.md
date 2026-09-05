# 销售送货单页面用例

## 范围

- 路由：`/vou/sale-delivery`，公共 Draft、查询、详情与生命周期编排见 [VOU 页面公共用例](README.md)。
- 业务不变量以 [VOU 领域文档](../../domains/vou.md#32-销售四单) 为准；请求与响应只采用可执行 Hono 路由。

## `VOU-SALE-DELIVERY-01` 业务工作区

1. 只读呈现来源出库、承运单位与车辆；由销售履约流程生成，不开放人工 Draft。
2. 页面不加载或保存本地 Draft，不显示新建、变更克隆或提交按钮。
3. 页面只执行服务器返回的审批动作；详情使用业务家族只读组件完整呈现已保存 payload。

## 验收

1. 列表固定每页 20 条，详情采用服务器 payload、revision、`availableApprovalActions` 和 `canDelete`。
2. 页面不显示 JSON 技术表单，不从描述器动态生成控件，不手输 Approval Entry。
3. 当前共享契约缺失的领域事实按公共用例的“当前契约缺口”披露，页面不以临时字段或前端推断补齐。
