---
id: ADR-0036
date: 2026-08-28
status: accepted
---

# 资金账户由 DCL 申报并投影到 BOB 当前业务面

资金账户沿用 ADR-0033 建立的写入所有权：稳定 subject 与完整强类型版本快照归 DCL，版本头和生命周期归中央 Approval，批准后的当前档案与 VOU/ACC 引用解析归 BOB。`/dcl/fund-account` 是新建、候选编辑、启停申请、审批、版本与审计的唯一维护入口；`/bob/fund-account` 只读取当前正式档案。旧 BOB lifecycle、直接启停、资金账户版本表、写权限与页面动作同时删除，不提供别名、双写或兼容读取。

每个资金账户快照完整保存名称、币种、户名、银行、支行、规范化账号、备注、所属经营主体及其精确 Approval Entry。币种与所属经营主体只能通过下一 DCL candidate 改变；批准和反批在同一 PostgreSQL transaction 原子切换或回落 BOB current。账号在 latest approved 与唯一 open candidate 之间共同占用，历史已释放账号可复用。已有 VOU 正文继续保存 stable fund account ID、实际采用的 Approval Entry ID 和不可变快照，并阻止该精确来源版本反批；ACC 只保存 stable fund account 维度，通过不可变的 VOU `source_id` 追溯实际来源版本，不重复保存资金账户快照。
