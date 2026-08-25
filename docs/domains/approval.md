# Approval 中央审批领域

## 1. 领域职责

Approval 是跨领域的中央审批能力，唯一拥有审批生命周期、操作授权、revision、审批元数据、审计事件和同步事务事件发布。业务 Domain 仍拥有稳定主体、业务数据、业务校验和强类型事件 payload；Approval 不认识任何 Domain 业务规则。

当前切片只交付 Approval-only 持久化与生命周期基础设施。BOB、AUX、VOU、ACC、RPT 和 WFL 仍使用它们当前的生命周期，直到后续独立切片完成迁移；本文不把尚未迁移的领域描述为已经使用 Approval。

## 2. 审批条目与主体边界

`approval_entries` 保存 `id`、`domain`、`entity`、`subject_id`、可空 `version_no`、`status`、`revision` 和统一元数据。Approval-only 条目的 `version_no` 必须为空，同一 `(domain, entity, subject_id)` 最多一条。表结构保留之后 Versioning 所需的非空版本号约束和查询索引，但当前 Coordinator 不创建或操作版本条目。

`subject_id` 是指向 Domain stable subject 的受控逻辑外键，不建立中央 `approval_subjects` 或 Domain Store Adapter。Domain application service 必须在同一 PostgreSQL transaction 内创建或删除 stable subject 和审批条目；任一步失败时整体回滚，不得留下 orphan。

`approval_events` 追加保存条目引用快照、动作、前后状态和 revision、操作者、reason、request 与时间。动作只有 `CREATED`、`SAVED`、`SUBMITTED`、`UNSUBMITTED`、`REJECTED`、`APPROVED`、`UNAPPROVED`和 `DELETED`。reason 只保存在 `REJECTED` 与 `UNAPPROVED` 审计事件及当次 typed event 中，不进入条目元数据。

## 3. 生命周期

唯一状态集合为 `DRAFT | PENDING | APPROVED`，唯一动作与转换为：

```text
DRAFT --submit--> PENDING --approve--> APPROVED
PENDING --unsubmit/reject--> DRAFT
APPROVED --unapprove--> PENDING
```

`save` 只能用于 `DRAFT`。每次 save 或 transition 必须令 `revision += 1`。`reject` 和 `unapprove` 必须提供非空 reason；`APPROVED` 的批准人必须与当前提交人不同。

状态与元数据始终精确对应：`DRAFT` 的提交和批准元数据均为空；`PENDING` 的提交元数据非空、批准元数据为空；`APPROVED` 两组元数据均非空。`unsubmit` 和 `reject` 清空提交元数据，`unapprove` 仅清空批准元数据。

## 4. 授权与事务边界

Coordinator 在每次写操作中使用 APP Authorizer 做最终权限校验，并且只能从自身固定的 `(domain, entity)` 与当次 action 生成 `/{domain}/{entity}/{action}`；调用方不能传入任意 permission path。Trusted System Actor 只能使用系统用户身份显式建立，它可免普通 HTTP role permission，但不能跳过状态、expected revision、reason、职责分离、Domain validation 或 transaction invariant。

事务由 Domain Service 或 application service 建立，Approval 只接收调用方的 `pgx.Tx`。`Prepare` 使用 `FOR UPDATE` 锁定条目并完成授权、expected revision、当前状态、合法转换、reason 和职责分离检查，但不写数据。Domain 完成业务校验并构造不可变 payload 后，`Commit` 更新条目、追加审计并通过强类型 topic 同步发布。

## 5. 强类型事务事件

Approval event 包含条目引用、动作、前后状态和 revision、操作者、request、reason、提交/批准元数据与 Domain 提供的完整不可变 payload。Domain 事件契约使用 `Topic[T]`、`Publish[T]` 和 `Subscribe[T]` 封装现有同步 `txevent.Bus`；producer 和 subscriber 只共享强类型 contract，不传递 `any`、raw JSON 或 `map[string]any` payload。

subscriber 必须复用发布者的同一 `pgx.Tx`，不得回查发布 Domain，也不得产生不可回滚副作用。任一 subscriber 返回 error 或 panic 都使当次 Approval 写入和所有订阅写入由调用方整体回滚。

## 6. 验收边界

当前切片的真实 PostgreSQL 验收覆盖 Approval-only 唯一性、正反状态转换、stale revision、permission denied、自批、缺失 reason、元数据精确性、每次 revision 递增、subscriber error/panic 回滚，以及 stable subject 与 entry 同事务创建/删除不留 orphan。页面在未迁移业务 Domain 前不调用 Approval API，因此本切片不新增或改写页面用例。
