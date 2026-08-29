---
id: ADR-0034
date: 2026-08-27
status: superseded
superseded_by: ADR-0047
---

# 仓库由 DCL 申报并投影到 BOB 当前业务面

仓库沿用 ADR-0033 建立的写入所有权：稳定 subject 与完整强类型版本快照归 DCL，版本头和生命周期归中央 Approval，批准后的当前档案与库存、VOU 引用解析归 BOB。`/dcl/warehouse` 是新建、候选编辑、启停申请、审批、版本与审计的唯一维护入口；`/bob/warehouse` 只读取当前正式档案。旧 BOB lifecycle、直接启停、版本表、权限与页面动作同时删除，不提供别名、双写或兼容路径。

仓库停用仍保留库存领域所需的严格事务边界。批准 `enabled=false` 的 DCL candidate 或反批回落到 disabled/absent 时，同一 PostgreSQL transaction 检查非零库存、进行中 VOU、仍可产生后续库存动作的来源单和当前 BOB 引用；任一 blocker 或 current apply 失败都会回滚 Approval、事件、DCL snapshot 与 BOB current。VOU 和 ACC 继续保存 stable warehouse ID，VOU 继续保存实际采用的精确 Approval Entry ID 与必要快照，因此迁移不改写历史业务事实。
