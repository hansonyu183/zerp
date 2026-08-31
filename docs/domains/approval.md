# Approval 中央审批领域

## 1. 领域职责

Approval 是跨领域的中央审批能力，唯一拥有审批生命周期、操作授权、revision、审批元数据、审计事件和同步事务事件发布。业务 Domain 仍拥有稳定主体、业务数据、业务校验和强类型事件 payload；Approval 不认识任何 Domain 业务规则。

中央能力同时提供 Approval-only 与 Approval Version 两种条目形态。VOU 和 ACC Opening 使用 Approval-only；实际写入 Approval Version 的业务 Domain 只有 DCL，其实体包括资料申报、ACC Mapping、RPT Definition 与 WFL Definition。BOB 只查询 DCL 当前有效的已批准资料，AUX 使用 Stable-ID Direct CRUD，两者均不注册 Approval subject；ACC、RPT 与 WFL 也不得为这些 DCL 实体另建 Approval subject。

## 2. 审批条目与主体边界

`approval_entries` 保存 `id`、`domain`、`entity`、`subject_id`、可空 `version_no`、`status`、`revision` 和统一元数据。Approval-only 条目的 `version_no` 必须为空，同一 `(domain, entity, subject_id)` 最多一条。Approval Version 条目的 `version_no` 必须为正数，`(domain, entity, subject_id, version_no)` 唯一；同一 stable subject 的 `DRAFT` 与 `PENDING` 合计最多一条。

`subject_id` 是指向 Domain stable subject 的受控逻辑外键，不建立中央 `approval_subjects` 或 Domain Store Adapter。Domain application service 必须在同一 PostgreSQL transaction 内创建或删除 stable subject 和审批条目；任一步失败时整体回滚，不得留下 orphan。

`approval_events` 追加保存条目引用快照、动作、前后状态和 revision、操作者、reason、request 与时间。动作只有 `CREATED`、`SAVED`、`SUBMITTED`、`UNSUBMITTED`、`REJECTED`、`APPROVED`、`UNAPPROVED`和 `DELETED`。reason 只保存在 `REJECTED` 与 `UNAPPROVED` 审计事件及当次 typed event 中，不进入条目元数据。

## 3. 生命周期

唯一状态集合为 `DRAFT | PENDING | APPROVED`，唯一动作与转换为：

```text
DRAFT --submit--> PENDING --approve--> APPROVED
PENDING --unsubmit/reject--> DRAFT
APPROVED --unapprove--> PENDING
```

`save` 只能用于 `DRAFT`。每次 save 或 transition 必须令 `revision += 1`。`reject` 和 `unapprove` 必须提供去除首尾空白后仍非空的 reason；`submit`、`unsubmit` 与 `approve` 不接受 reason。`PENDING` 的 `approve` 和 `reject` 操作者都必须与当前提交人不同。

状态与元数据始终精确对应：`DRAFT` 的提交和批准元数据均为空；`PENDING` 的提交元数据非空、批准元数据为空；`APPROVED` 两组元数据均非空。`unsubmit` 和 `reject` 清空提交元数据，`unapprove` 仅清空批准元数据。

### 3.1 Wire values 与最小共享中文映射

HTTP 状态 wire value 只有 `DRAFT`、`PENDING`、`APPROVED`，共享中文分别为“草稿”“待批准”“已批准”。公开生命周期 action 只有 `submit`、`unsubmit`、`reject`、`approve`、`unapprove`，共享中文分别为“提交”“撤回”“驳回”“批准”“反批准”。创建、保存和删除是资源动作，不增加审批状态；审计 action 只有 `CREATED`、`SAVED`、`SUBMITTED`、`UNSUBMITTED`、`REJECTED`、`APPROVED`、`UNAPPROVED`、`DELETED`。

中央 Approval 可返回的稳定 `errorKey` 完整集合为：`approval_invalid_actor`、`approval_invalid_configuration`、`approval_invalid_action`、`approval_invalid_revision`、`approval_invalid_request`、`approval_invalid_preparation`、`approval_not_found`、`approval_version_not_found`、`approval_stale_revision`、`approval_invalid_transition`、`approval_self_review_forbidden`、`approval_reason_required`、`approval_reason_not_allowed`、`approval_version_history_exists`、`approval_open_version_exists`、`approval_no_approved_version`、`approval_not_latest_approved`、`approval_versioned_entry`、`approval_not_versioned`、`approval_version_number_conflict`、`approval_conflict`、`approval_event_delivery_failed`。Domain blocker 使用各领域自己的稳定 `errorKey`，不得伪装成 Approval 状态或 message 分支；不保留旧自批错误别名。

### 3.2 Approval Action Availability

Approval Action Availability 是中央 Approval 根据条目当前 `status`、`submittedBy`、当前操作者身份和五项精确生命周期权限生成的查询时快照。它只使用 Approval 自有事实，不运行库存、期间、引用、最高正式版本或其他 Domain blocker precheck，也不接受调用方传入任意权限路径、支持动作集合、callback、profile 或运行时注册项。

动作按 `submit`、`unsubmit`、`reject`、`approve`、`unapprove` 的固定顺序返回，资格闭集如下：

| Approval Status | 当前操作者 | 可按精确权限返回的动作          |
| --------------- | ---------- | ------------------------------- |
| `DRAFT`         | 任意       | `submit`                        |
| `PENDING`       | 提交人本人 | `unsubmit`                      |
| `PENDING`       | 其他人     | `unsubmit`、`reject`、`approve` |
| `APPROVED`      | 任意       | `unapprove`                     |

表中每个动作只有在操作者拥有对应 `/{domain}/{entity}/{action}` 精确权限时才返回；`query`、`get`、`save` 或其他宽泛权限不能替代。查询响应中的动作列表不是授权凭证，实际动作接口必须重新检查当前会话、精确权限、状态、revision、职责分离、版本不变量和 Domain blocker。任何快照失效都拒绝当前调用，由客户端刷新事实且不得自动重试。

## 4. 授权与事务边界

Coordinator 在每次写操作中使用 APP Authorizer 做最终权限校验，并且只能从自身固定的 `(domain, entity)` 与当次 action 生成 `/{domain}/{entity}/{action}`；调用方不能传入任意 permission path。`approve` 与 `reject` 对提交人本人统一返回 `approval_self_review_forbidden`。Trusted System Actor 只能使用系统用户身份显式建立，它可免普通 HTTP role permission，但不能跳过状态、expected revision、reason、职责分离、Domain validation 或 transaction invariant。

事务由 Domain Service 或 application service 建立，Approval 只接收调用方的 `pgx.Tx`。Approval Version 以 `(domain, entity, subject_id)` 的 PostgreSQL transaction-scoped advisory lock 串行化版本历史读写；所有版本历史读取、候选创建/删除、版本条目 `Prepare` 与 `Commit` 都先取得该锁，再取得条目行锁。`Prepare` 使用 `FOR UPDATE` 锁定条目并完成授权、expected revision、当前状态、合法转换、reason 和职责分离检查，但不写数据。Versioned subject 的反批准还在该阶段确认目标仍是最高 `APPROVED` 且不存在其他 `DRAFT`/`PENDING` 候选；已有开放候选时直接返回稳定错误 `approval_open_version_exists`。Domain 完成业务校验并在调用前构造纯业务不可变 payload，`Commit(ctx, tx, prepared, payload)` 在仍持有 subject lock 时重新锁定条目并复核这些版本不变量，随后更新条目、追加审计并通过强类型 topic 同步发布。Approval 不接受 callback，也不调用领域函数或回查领域数据。

## 5. 强类型事务事件

Approval event 包含条目引用、动作、前后状态和 revision、操作者、request、reason、提交/批准元数据与 Domain 提供的完整不可变 payload。类型参数 `T` 只保存纯业务快照，不重复条目引用、动作、前后状态、revision、操作者或提交/批准元数据。Domain 事件契约使用 `Topic[T]`、`Publish[T]` 和 `Subscribe[T]` 封装现有同步 `txevent.Bus`；producer 和 subscriber 只共享强类型 contract，不传递 `any`、raw JSON 或 `map[string]any` payload。

subscriber 必须复用发布者的同一 `pgx.Tx`，不得回查发布 Domain，也不得产生不可回滚副作用。任一 subscriber 返回 error 或 panic 都使当次 Approval 写入和所有订阅写入由调用方整体回滚。

Versioned event 由 Approval 填充 `VersionNo`、`PreviousApprovedVersionID` 和 `CurrentApprovedVersionID`。后两个版本身份分别表示动作前与动作后按最高已批准版本号计算出的正式版本；首次批准前者为空，反批准 V1 后后者为空。Domain 只提供不可变 payload，不推导版本号或正式版本身份。

## 6. Approval Version

`CreateFirstVersion` 建立 V1 草稿；只有尚无任何版本历史的 stable subject 可以调用。`CreateNextVersion` 以最高 `APPROVED version_no + 1` 建立候选；没有正式版本或已经存在开放候选时拒绝。删除草稿候选不消耗编号，因此下一次创建会复用同一号码。系统不保存 `next_version_no`。

`GetLatestApproved` 始终返回 `version_no` 最高的 `APPROVED` 条目；`GetOpenVersion` 返回唯一的 `DRAFT` 或 `PENDING` 候选；`ListVersions` 按版本号倒序返回完整版本头。系统不维护 `current_version_id`、`effective_version_id`、`base_version_id` 或其他当前指针。

`DeleteDraftVersion` 只删除 Approval Version 的 `DRAFT` 候选。只允许反批准当前最高的 `APPROVED`：反批准 V2 后 V1 自然成为正式版本；反批准 V1 后允许没有正式版本。若已有另一开放候选，`Prepare` 在业务写入前返回 `approval_open_version_exists`；PostgreSQL 的开放候选部分唯一约束继续作为最终并发防线，正常流程不依赖 unique violation。

首次版本创建使用 `create` 权限，后续候选创建使用 `save` 权限，版本删除使用 `delete` 权限，读取当前版本使用 `get` 权限，历史列表使用 `versions` 权限；这些路径仍由 Coordinator 从固定 `(domain, entity, action)` 生成。

## 7. 验收边界

真实 PostgreSQL 验收覆盖 Approval-only 唯一性、V1/V2、候选删除后复号、latest approved、只反批准 latest、正式版本回落、版本号与开放候选唯一性、并发候选，以及正反状态转换、stale revision、permission denied、自批与自驳回、必需或禁止 reason、元数据精确性、每次 revision 递增、subscriber error/panic 回滚和 stable subject-entry 同事务创建/删除不留 orphan。表格测试覆盖每种状态、每项精确权限、提交人/非提交人和动作确定顺序。
