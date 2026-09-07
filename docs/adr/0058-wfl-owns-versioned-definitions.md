---
id: ADR-0058
date: 2026-09-07
status: accepted
partially_supersedes: ADR-0046, ADR-0047, ADR-0051, ADR-0052, ADR-0055
---

# WFL 拥有流程定义并组合公共审批与版本

WFL stable identity、脚本、编译图、试算、提交、审批、历史与运行开关在同一个 WFL 资源维护；实例与动作仍由 WFL 持久化。WFL 独立消费公共 ApprovalPersistence 与 VersionedArchives，在领域拥有的同一事务中执行，不迁入 BOB，也不复制版本头或 current pointer。

当前最高已批准定义 `query/get` 与 `submission-query/submission-get` 分开；旧 DCL 读取权限分别转为提交读取，旧 WFL 当前读取权限保持。提交、审批、历史、删除与启停权限一对一迁移。一次性迁移保留稳定身份、编码、历史版本、Entry 与全部运行事实，只更改归属和外键；无旧入口、别名、双写或兼容读取。

实例先于当前匹配：新根单据采用当前可用 immutable version；根单据重新批准时沿用已有实例。新版本、批准和停用不改变旧实例的名称、脚本、节点或动作语义。Starlark 零写入试算、真实 VOU 写入口、动作指纹、create-child 幂等与反批准 blocker 保持。

临时表单不持久化，关闭或账号变化销毁输入；提交幂等与未知结果核实保持。独立 runtime revision 控制即时启停，并在同一事务保存审计；审批不覆盖 enabled。

本决定部分替代 ADR-0046 的 WFL 必须由 DCL 写入条款、ADR-0047 的 WFL stable subject 必须由 DCL 持有条款、ADR-0051 的 DCL 独占 WFL 提交与本地持久化草稿条款、ADR-0052 的 WFL 尚未迁移描述，以及 ADR-0055 的 WFL 只预留接口尚未消费公共版本描述。上述 ADR 的其他业务、权限、事务与 Hono 契约规则仍有效。ADR-0003 的 Starlark 与 immutable instance 规则保持。

对应 [#401](https://github.com/hansonyu183/zerp/issues/401) 与 [#392](https://github.com/hansonyu183/zerp/issues/392)。
