---
id: ADR-0053
date: 2026-09-07
status: accepted
partially_supersedes: ADR-0047, ADR-0049, ADR-0051
---

# 经营主体和员工归 AUX current，编辑输入只保留在页面

经营主体和员工是直接维护的辅助资料。两者在 AUX 保存后立即生效，启停独立，不再经过 DCL Submission、Approval 或业务版本；其他业务在采用时保存 stable ID 和 typed snapshot，历史解释不会随 current 修改而变化。领域规则见 [AUX](../domains/aux.md#39-经营主体与员工)，实施范围来自 [#394](https://github.com/hansonyu183/zerp/issues/394) 和 [#392](https://github.com/hansonyu183/zerp/issues/392)。

本决定替换 ADR-0047/0049 中经营主体和员工必须由 DCL 持有 current 身份及版本生命周期的条款；其余档案的现行生命周期、独立身份和类型内唯一性规则继续有效。一次性转换保留 ID、编码、历史快照和审计，未决内容冲突返回 blocker，不提供运行时旧入口或回退读取。权限按已确认的动作对应转换，旧开放提交删除不授予对象物理删除。

本决定替换 ADR-0051 的 IndexedDB 多草稿、自动保存与刷新恢复条款：编辑输入只属于页面实例，确定失败保留，关闭、刷新、退出或切换后销毁。克隆仅预填新表单；服务器不可变 Submission、幂等、未知写入核实和已提交附件规则继续有效。当前前端没有对应 IndexedDB 存储实现，不增加待删除的草稿系统。
