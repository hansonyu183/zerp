---
id: ADR-0036
date: 2026-08-28
status: superseded
superseded_by: ADR-0047
---

# 资金账户由 DCL 申报并由 BOB 只读查询

资金账户 stable subject、业务编码与完整强类型版本快照归 DCL，版本头和生命周期归中央 Approval。`/dcl/fund-account` 是新建、候选编辑、启停申请、审批、版本与审计的唯一维护入口；`/bob/fund-account` 直接读取 highest APPROVED snapshot，不保存资金账户副本或提供写动作。

每个资金账户快照完整保存名称、币种、户名、银行、支行、规范化账号、备注、所属经营主体及其精确 Approval Entry。币种与所属经营主体只能通过下一 DCL candidate 改变。账号在 latest approved 与唯一 open candidate 之间共同占用，历史已释放账号可复用。已有 VOU 正文继续保存 stable fund account ID、实际采用的 Approval Entry ID 和不可变快照，并阻止该精确来源版本反批；ACC 只保存 stable fund account 维度。
