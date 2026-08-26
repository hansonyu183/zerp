# 流程定义管理

## 页面目标

流程管理员管理稳定流程定义及其 Approval Version 脚本。定义、试算、版本和 enabled 规则见 [WFL 定义与 Approval Version](../../domains/wfl.md#2-定义与-approval-version)；HTTP 线协议见 [OpenAPI](../../../contracts/openapi/openapi.yaml)。状态、徽标、动作和版本历史中文文案使用 `frontend/src/shared/approval/` 的统一映射。

## 主流程

1. 页面查询定义时，每个 stable definition 只显示唯一开放候选（`DRAFT`/`PENDING`）或没有候选时的最新已批准 entry；名称取该 entry 的编译图。选择历史中的精确 `approvalEntryId` 时展示该版本脚本、名称、诊断和只读编译图。
2. 管理员创建定义会得到 V1 DRAFT；保存时提交 definitionId、approvalEntryId、当前 Approval revision 和完整脚本。冲突时重新读取该 entry，不覆盖服务端草稿。
3. 已批准定义要修改时，管理员创建下一候选版本；页面可读取 versions，DRAFT 候选可删除。候选不影响正在运行的实例。
4. 管理员输入存在的 VOU entity 和 documentId 试算当前 DRAFT entry。页面展示命中轨迹、计划动作和未覆盖分支，不搜索或展示 VOU 正文。
5. 试算成功后按 `submit`、`approve` 完成审批；`unsubmit`、`reject`、`unapprove` 按统一生命周期处理，reject 和 unapprove 必须填写非空 reason。
6. 有 latest APPROVED entry 后，管理员可独立启用或停用 definition；启用只影响未来根单据，既有实例继续固定自己的 approvalEntryId。

## 异常分支

- 编译失败：保存脚本和诊断，禁止试算、提交和批准该 entry。
- 试算对象不存在或类型与根节点不同：显示业务 errorKey，不记录成功证明。
- Approval revision 冲突：不覆盖服务端草稿。
- 未成功试算的候选提交/批准、非 DRAFT 保存/删除、非最新批准反批：服务端返回稳定 errorKey。
- enabled 为 true 但不存在 latest APPROVED：服务端拒绝。
