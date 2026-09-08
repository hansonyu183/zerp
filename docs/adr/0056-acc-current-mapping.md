---
id: ADR-0056
date: 2026-09-07
status: accepted
supersedes: ADR-0044
partially_supersedes: ADR-0046, ADR-0047, ADR-0052
---

# 会计映射回归 ACC 当前配置

按 [#399](https://github.com/hansonyu183/zerp/issues/399) 与 [#392](https://github.com/hansonyu183/zerp/issues/392)，ACC 按 `(bookId, vouEntity)` 稳定身份直接维护当前会计映射。保存完整验证条件互斥、默认结果、模板、字段目录、启用末级科目与维度，使用对象 revision 控制并发，在同一事务替换当前配置、科目引用与审计。新配置不建立 Submission、Approval Version 或映射执行实例。

ACC `query/get/catalog/save` 分别精确授权，并遵守账簿查询或操作范围。普通角色不从旧提交或审批权限自动获得 `save`；旧查询/读取路径仅转换到对应当前读取权限，其余生命周期权限退出目录。映射页面提供类型化编辑，只保存当前页面输入，无持久草稿、提交或审批操作。

VOU 批准在领域事务中采用当前配置形成会计事实；分录记录映射稳定 ID 和采用的 revision。修改配置不重算旧分录。历史记账来源、旧 Approval 和映射历史作为只读证据保留，运行时不读取历史版本、不回退。未决候选冲突阻止一次性转换；只有开放 V1 时保留其内容用于当前维护，不自动批准它。

本决定完全替代 ADR-0044；部分替代 ADR-0046/0047 中会计映射的 DCL 归属、版本与审批条款，兑现 ADR-0052 中 ACC 配置切片。其他对象的生命周期、Hono/Zod 契约、精确授权、领域事务、临时表单与历史连续性规则继续有效。
