---
id: ADR-0044
date: 2026-08-28
status: accepted
---

# 会计映射申报由 DCL 拥有并投影到 ACC 当前记账解释

会计映射的稳定主体 `(bookId, vouEntity)` 由 DCL 唯一拥有创建、候选编辑、提交、撤回、驳回、批准、反批、草稿删除、版本历史和审计。`/dcl/acc-mapping` 是会计映射唯一维护入口；`/acc/mapping` 只提供当前最新批准映射的 `query|get` 和稳定字段目录 `catalog`，不提供版本写入、生命周期或候选查询。

批准或反批在同一 PostgreSQL transaction 内原子更新 ACC 的最新批准当前记账解释和精确科目引用登记：批准新版本时登记新版本的末级科目引用，反批时回落到上一正式版本的引用集合。已被 VOU 会计凭证以精确 `mappingApprovalEntryId` 引用的版本不得反批，但该 stable subject 的下一候选仍允许创建和审批；历史凭证的身份和记账结果永远不被重算。

DCL 不保存 `currentVersionId`、`effectiveVersionId`、`baseVersionId` 或 `nextVersionNo`。ACC 当前映射只读页面只检查 ACC `query`、`get` 与 `catalog` 权限，不得因用户具有 DCL 权限而显示生命周期动作。旧会计映射 ACC 写/生命周期路由和权限不再暴露，生命周期动作本身要求对应 DCL 权限。APP 工作台和审批深链固定进入 DCL 页面。
