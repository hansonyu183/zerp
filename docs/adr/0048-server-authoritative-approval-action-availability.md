---
id: ADR-0048
date: 2026-08-31
status: accepted
partially_superseded_by: ADR-0051
---

# Approval 动作资格由服务端中央决策

ZERP 由中央 Approval 根据条目事实、当前操作者与五项精确生命周期权限生成 Approval Action Availability，并由各查询响应返回；APP 工作台只组合查看、编辑等资源动作，前端只负责共享 presentation 与执行编排。动作列表是当前会话的查询快照，不是授权凭证，执行接口仍重新检查权限、状态、revision、职责分离和 Domain blocker。

我们不采用前端按状态与权限推断，也不让各 Domain 分别计算或通过通用规则引擎、运行时注册表配置动作。中央决策使职责分离、确定顺序和完整动作闭集只有一个业务权威，同时保留 Domain 对业务 blocker 与事务的所有权；代价是需要把当前操作者相关的动作数组加入会渲染生命周期控制的查询投影，并在权限或条目事实变化后刷新快照。
