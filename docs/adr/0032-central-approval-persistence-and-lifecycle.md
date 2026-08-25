---
id: ADR-0032
date: 2026-08-25
status: accepted
---

# 审批持久化、生命周期与版本头由中央 Approval 统一拥有

ZERP 将审批状态、revision、元数据、审计、APP 动作授权、强类型同步事务事件和可选版本头集中到一套 Approval 持久化与 Coordinator。各业务 Domain 仅拥有 stable subject、业务 payload 和业务校验，并在自己创建的 PostgreSQL transaction 内调用 Approval；不建立 Domain Store Adapter、中央 subject 表、callback/hook、异步 broker、各域独立状态机或 Approval 外的通用版本引擎。

Approval Version 以正数 `version_no` 表示同一 stable subject 的版本历史；版本号和开放候选分别由唯一索引约束。中央 Approval 对每个 `(domain, entity, subject_id)` 在读取或变更版本历史前取得 PostgreSQL transaction-scoped advisory lock，并始终先取得 subject lock 再取得条目行锁；下一候选号只从最高正式版本计算，删除候选后复号。正式版本只按最高 `APPROVED version_no` 查询，不保存 current、effective、base 或 next pointer。只有最新正式版本可以反批，且 Commit 会在持锁状态再次验证；中央 typed event 给出动作前后正式版本 identity，Domain 不自行推导。

这一边界用受控逻辑外键保留 Domain 主体所有权，以数据库约束表达审批内部不变量，并以同事务集成测试证明 subject-entry 原子性和 subscriber 失败回滚。中央化使生命周期、版本与授权规则无法被 Domain 绕过，代价是后续各域必须以独立切片删除旧持久化和事件路径。在 VOU 迁移切片合并前，本 ADR 不取代 ADR-0004 对当前 VOU 运行行为的描述。
