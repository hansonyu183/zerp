---
id: ADR-0039
date: 2026-08-28
status: superseded
superseded_by: ADR-0047
---

# 员工申报由 DCL 拥有并投影到 BOB 当前业务面

员工稳定 root 继续是 `bob_objects(entity=employee)`，`bob_employment_relationships` 永久表达员工、Party 与经营主体之间不可替代的雇佣边界；但员工的创建、候选版本、启停、审批、历史与审计统一归 DCL。唯一维护实体和路径是 `employee` 与 `/dcl/employee`，不建立 `employment` 别名。`/bob/employee` 只读取 DCL latest approved 投影并提供引用候选，不能创建、保存、启停或驱动生命周期。

每个员工候选快照只保存雇佣资料：人员类别、部门、岗位、工作电话、工作邮箱、入职日期、备注和 `enabled`。Party identity 与姓名不复制到员工快照；新建时可选择已有 Party 或同时提交 `newParty`，后者在同一个 transaction 建立 Party root、DCL Party V1 candidate、员工 root、首个员工 candidate 与雇佣边界。员工 submit 与 approve 都要求 Party 已有 current approved 版本，未获批 Party 不能形成员工 current。

人员类别是 AUX `employee-category`，字段只有 `name` 与 `description`，编码前缀为 `ECT`，不预置或发明基线值。员工候选对人员类别、部门、岗位与经营主体保存 stable ID、精确 Approval Entry、编码和名称快照；保存时按 latest approved 解析，submit/approve 时重新确认已保存来源仍为 latest approved。

员工批准或反批在同一 PostgreSQL transaction 创建、替换、回落或移除 BOB current source。BOB current 与 VOU/ACC 事实继续提供 stable ID、精确 Approval Entry 和所需快照；已有事实精确引用某 employee entry 时，该 entry 不得反批。后续版本不得改写历史，反批最新批准版本只回落到上一 approved snapshot。
