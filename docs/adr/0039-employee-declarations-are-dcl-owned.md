---
id: ADR-0039
date: 2026-08-28
status: superseded
superseded_by: ADR-0047
---

# 员工申报由 DCL 拥有并由 BOB 只读查询

员工 stable subject 归 `dcl_subjects(entity=employee)`，`dcl_employment_relationships` 表达员工、Party 与经营主体之间不可替代的雇佣边界；员工创建、候选版本、启停、审批、历史与审计统一归 DCL。唯一维护路径是 `/dcl/employee`；`/bob/employee` 只读取 highest APPROVED snapshot 并提供引用候选。

每个员工候选快照只保存雇佣资料：人员类别、部门、岗位、工作电话、工作邮箱、入职日期、备注和 `enabled`。Party identity 与姓名不复制到员工快照；新建时可选择已有 Party 或同时提交 `newParty`，后者在同一个 transaction 建立 Party subject、DCL Party V1 candidate、员工 subject、首个员工 candidate 与雇佣边界。员工 submit 与 approve 都要求 Party 已有当前有效批准版本。

人员类别是 AUX `employee-category`，字段只有 `name` 与 `description`，编码前缀为 `ECT`，不预置或发明基线值。员工候选对人员类别、部门、岗位与经营主体保存 stable ID、精确 Approval Entry、编码和名称快照；保存时按 latest approved 解析，submit/approve 时重新确认已保存来源仍为 latest approved。

员工批准或反批只改变 Approval 生命周期；BOB 读取结果由 highest APPROVED 查询自然切换、回落或隐藏。VOU/ACC 事实继续保存 stable ID、精确 Approval Entry 和所需快照；已有事实精确引用某 employee entry 时，该 entry 不得反批。
