---
id: ADR-0045
date: 2026-08-29
status: accepted
partially_superseded_by: ADR-0051
---

# 流程定义申报由 DCL 拥有并供 WFL 当前执行

流程定义的稳定主体 `wfl-process-definition` 由 DCL 唯一拥有创建、候选编辑、提交、撤回、驳回、批准、反批、草稿删除、版本历史和审计。`/dcl/wfl-process-definition` 是流程定义唯一维护入口，覆盖完整生命周期和版本编排；WFL 只保留当前定义的 `query|get`、脚本与编译图的领域能力、试算、实例创建、执行和运行动作。WFL 不拥有版本写入、生命周期或候选查询，也不提供定义维护、审批或版本页面。

`dcl_subjects(entity=wfl-process-definition)` 是 definition stable ID、code、`createdAt` 与 `createdBy` 的唯一持有者；code 必须匹配 `^[a-z][a-z0-9-]{1,62}[a-z0-9]$`。WFL 只以 `wfl_definition_runtime_states(subjectId PK/FK, enabled, updatedAt, updatedBy)` 保存独立运行开关；该 dependent 不得重复 ID、code、创建审计、revision 或 Approval pointer。`dcl_wfl_process_definition_versions.definitionId`、`wfl_definition_instances.definitionId` 与 `wfl_create_child_requests.definitionId` 全部引用 runtime state 的 `subjectId`，使所有运行引用共享同一个 DCL 身份且保留 typed entity 约束；不存在 `wfl_process_definitions`、兼容视图或第二写入路径。

新建顺序固定在同一事务内完成：创建带 code 的 DCL subject、创建 runtime state、创建中央 Approval V1 `DRAFT`、保存 typed version。任一步失败必须整体回滚。存量 cutover 原位保留旧 stable ID、code、创建审计、Approval Entry、实例、子单请求和运行审计，将 code 与创建审计迁入 subject、运行开关与更新审计迁入 runtime state，重接全部 dependent FK 后删除旧根；空 code、重复 code、subject/runtime 不一一对应或任一 dependent orphan 都必须使 cutover 原子失败。

批准或反批后，WFL 直接读取 latest APPROVED typed snapshot 作为当前定义。已被任一持久化 WFL 实例以精确 `approvalEntryId` 引用的版本不得反批，不存在强制反批；该 stable subject 的下一候选仍允许创建和审批。新实例固定启动时 latest APPROVED 的 `approvalEntryId`，既有实例继续固定自己的 entry，定义后续改版不改写历史实例。

`enabled` 是 stable definition 上不进入版本 payload 的独立运行开关，但不拥有第二套 revision。启停必须携带 latest APPROVED 的 `approvalEntryId` 与 `approvalRevision`，由 DCL 在 subject lock 内校验后更新。同一审批身份下的重复或相反启停请求刻意采用 last-command-wins：subject lock 保证串行执行，最后一次成功请求决定运行开关；只有 latest APPROVED 身份或 Approval revision 改变才返回并发冲突，不为该开关增加独立 revision。

DCL 不保存 `currentVersionId`、`effectiveVersionId`、`baseVersionId` 或 `nextVersionNo`。WFL 当前定义只读页面只检查 WFL `query` 与 `get`，不得因用户具有 DCL 权限而显示生命周期动作。权限切换保留已有角色关联但不保留旧 WFL 定义写路径；流程定义原 WFL 写/生命周期权限不再暴露，生命周期动作本身要求对应 DCL 权限。APP 工作台和审批深链固定进入 DCL 页面。

Starlark 脚本、编译图、试算零写入 adapter、类型化 `WorkflowActions`、实例树、动作幂等和运行审计仍由 WFL 领域拥有；这些能力不迁入通用 DCL 引擎。试算是 WFL 领域能力，由 DCL 维护流程在保存或提交前调用，两个领域通过已有的领域接缝协作。

对应最终身份与数据库不变量收口 [#316](https://github.com/hansonyu183/zerp/issues/316)。
