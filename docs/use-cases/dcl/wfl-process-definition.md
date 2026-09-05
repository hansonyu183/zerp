# 流程定义申报

## 页面与目标

- 页面：`/dcl/wfl-process-definition`
- 组件：`frontend/src/target/pages/dcl/wfl-process-definition/WflProcessDefinition.vue`
- 目标：编辑 Starlark 流程脚本，以真实 VOU 单据试算，并管理候选、审批和运行启停。

## 编排

脚本与 typed trial document 仅保存在当前用户本地 Draft；`submit-new|submit-change` 才写入服务器候选。试算单据必须从所选 VOU entity 的真实查询结果中选择，页面展示单号和审批状态，不接受技术 ID 手填。试算调用 `/wfl/process-definition/trial`，候选生命周期调用 `/dcl/wfl-process-definition/*`。审批动作只使用服务器 `availableApprovalActions`；试算与启停分别叠加 `/wfl/process-definition/trial`、`/dcl/wfl-process-definition/enable|disable` 精确权限，启停使用 latest approved entry 的 approval revision 与 runtime revision。业务规则见 [DCL 流程定义申报](../../domains/dcl.md#310-流程定义申报) 和 [WFL 领域](../../domains/wfl.md)。

## 异常与验收

- 试算或提交失败保留脚本、单据类型和单据 ID；成功提交后才删除本地 Draft。
- CHANGE Draft 固定携带 latest approved submission/revision；冲突时不得覆盖新版本。
- 验收覆盖编译/试算诊断、NEW/CHANGE、服务器权威审批、开放候选删除与 CAS 启停。
