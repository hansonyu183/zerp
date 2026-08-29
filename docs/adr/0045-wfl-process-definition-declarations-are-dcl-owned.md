---
id: ADR-0045
date: 2026-08-29
status: accepted
---

# 流程定义申报由 DCL 拥有并供 WFL 当前执行

流程定义的稳定主体 `wfl-process-definition` 由 DCL 唯一拥有创建、候选编辑、提交、撤回、驳回、批准、反批、草稿删除、版本历史和审计。`/dcl/wfl-process-definition` 是流程定义唯一维护入口，覆盖完整生命周期和版本编排；WFL 只保留当前定义的 `query|get`、脚本与编译图的领域能力、试算、实例创建、执行和运行动作。WFL 不拥有版本写入、生命周期或候选查询，也不提供定义维护、审批或版本页面。

批准或反批后，WFL 直接读取 latest APPROVED typed snapshot 作为当前定义。已被任一持久化 WFL 实例以精确 `approvalEntryId` 引用的版本不得反批，不存在强制反批；该 stable subject 的下一候选仍允许创建和审批。新实例固定启动时 latest APPROVED 的 `approvalEntryId`，既有实例继续固定自己的 entry，定义后续改版不改写历史实例。

`enabled` 是 stable definition 上不进入版本 payload 的独立运行开关，但不拥有第二套 revision。启停必须携带 latest APPROVED 的 `approvalEntryId` 与 `approvalRevision`，由 DCL 在 subject lock 内校验后更新。

DCL 不保存 `currentVersionId`、`effectiveVersionId`、`baseVersionId` 或 `nextVersionNo`。WFL 当前定义只读页面只检查 WFL `query` 与 `get`，不得因用户具有 DCL 权限而显示生命周期动作。权限切换保留已有角色关联但不保留旧 WFL 定义写路径；流程定义原 WFL 写/生命周期权限不再暴露，生命周期动作本身要求对应 DCL 权限。APP 工作台和审批深链固定进入 DCL 页面。

Starlark 脚本、编译图、试算零写入 adapter、类型化 `WorkflowActions`、实例树、动作幂等和运行审计仍由 WFL 领域拥有；这些能力不迁入通用 DCL 引擎。试算是 WFL 领域能力，由 DCL 维护流程在保存或提交前调用，两个领域通过已有的领域接缝协作。
