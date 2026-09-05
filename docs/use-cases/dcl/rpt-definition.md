# 报表定义申报

## 页面与目标

- 页面：`/dcl/rpt-definition`
- 组件：`frontend/src/target/pages/dcl/rpt-definition/RptDefinition.vue`
- 目标：编辑 SQL、结构化参数和结果列，并完成 DCL 候选生命周期；不使用通用档案表单或定义 JSON。

## 编排

页面使用 `/dcl/rpt-definition/query|get|submit-new|submit-change|approve|reject|unreject|unapprove|delete`。本地 Draft 独立保存，正式版本通过 clone 建立 CHANGE Draft。参数类型、引用类型、结果列类型和可见性来自当前模型 wire values；审批动作只呈现服务器 `availableApprovalActions`。VALID/INVALID 只展示服务器技术有效性，不由页面推导。业务规则见 [DCL 报表定义申报](../../domains/dcl.md#39-报表定义申报) 和 [RPT 领域](../../domains/rpt.md)。

## 异常与验收

- 提交失败保留 SQL、参数和列；成功提交后才删除本地 Draft。
- 参数键与列别名不得重复，至少声明一个结果列；服务器仍执行完整 SQL/参数/列批准门禁。
- 验收覆盖 NEW/CHANGE、审批/反批准、INVALID 阻断运行及运行权限的原子切换。
