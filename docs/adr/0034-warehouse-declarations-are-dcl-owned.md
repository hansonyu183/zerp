---
id: ADR-0034
date: 2026-08-27
status: superseded
superseded_by: ADR-0047
---

# 仓库由 DCL 申报并由 BOB 只读查询

仓库 stable subject、业务编码与完整强类型版本快照归 DCL，版本头和生命周期归中央 Approval。BOB 不保存仓库副本，`/bob/warehouse` 直接读取 highest APPROVED snapshot；`/dcl/warehouse` 是新建、候选编辑、启停申请、审批、版本与审计的唯一维护入口。

仓库停用仍保留库存领域所需的严格事务边界。批准 `enabled=false` 或反批回落到 disabled/absent 时，同一 PostgreSQL transaction 检查非零库存、进行中 VOU、仍可产生后续库存动作的来源单和当前有效引用；任一 blocker 失败都会回滚 Approval、事件与 DCL snapshot。VOU 和 ACC 继续保存 stable warehouse ID，VOU 继续保存实际采用的精确 Approval Entry ID 与必要快照。
