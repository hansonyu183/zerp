# 会计映射申报

## 页面与目标

- 页面：`/dcl/acc-mapping`
- 组件：`frontend/src/target/pages/dcl/acc-mapping/AccMapping.vue`
- 目标：以领域结构编辑 MappingDefinition，而不是编辑 JSON；完成本地 Draft、提交、审批与开放候选删除。

## 编排

本地 Draft 保存账簿、VOU 类型、默认结果、匹配规则、凭证模板、借贷分录和资产配置；`submit-new|submit-change` 才创建服务器候选。账簿、VOU 类型、模板引用、固定科目、成本对应科目和映射字段均从当前目录候选选择；固定科目只使用所选账簿的启用末级科目，所需维度键由科目事实给出，维度值继续选择 VOU field path。正式版本只能克隆成新的本地变更 Draft。列表及 lifecycle 使用 `/dcl/acc-mapping/query|get|submit-new|submit-change|approve|reject|unreject|unapprove|delete`，动作只取服务器 `availableApprovalActions`。领域约束见 [DCL 会计映射申报](../../domains/dcl.md#38-会计映射申报) 和 [ACC 映射](../../domains/acc.md)。

## 异常与验收

- 本地保存或提交失败保留 Draft 全部结构；成功提交后才删除本地 Draft。
- 每个凭证模板至少两条分录；默认 POST 必须选择默认模板，服务器继续校验字段目录、科目和维度。
- 验收覆盖 NEW/CHANGE、独立版本事实、服务器权威审批动作和 revision 冲突。
