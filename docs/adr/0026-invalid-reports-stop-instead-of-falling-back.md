---
id: ADR-0026
date: 2026-08-13
status: accepted
---

# Invalid reports stop instead of falling back

RPT 使用无审批、无业务版本的单一当前定义。保存前验证只读 SQL、参数、PREPARE、EXPLAIN、限量执行与零行列元数据，验证成功后原子更新 revision 与有效性。确定性失效停止当前定义执行并关闭查询/导出权限，保留身份、角色关联及运行审计。修正当前定义并验证保存后恢复；不得回退历史口径或保留兼容视图。readiness 继续验证全部启用定义。旧 Approval 与版本仅作为转换前历史证据。
