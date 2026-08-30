---
id: ADR-0047
date: 2026-08-29
status: accepted
supersedes: ADR-0033, ADR-0034, ADR-0035, ADR-0036, ADR-0037, ADR-0038, ADR-0039, ADR-0040, ADR-0041, ADR-0042
---

# DCL Subject 是版本化业务对象的唯一稳定身份

所有版本化业务对象统一以 `dcl_subjects` 作为唯一通用稳定身份。subject 保存不可变 stable ID、entity、business code 与创建审计信息；`(entity, upper(code))` 对非空 code 唯一。只有 Party 与 ACC Mapping 是无编码 subject，允许 code 为空；Operating Entity、Warehouse、Vehicle、Fund Account、Product、Employee、Customer、Customer Account、Supplier、Other Unit、Sales Partner、RPT Definition 与 WFL Process Definition 的 code 必须非空并由数据库按 entity 校验格式。普通业务编码分别强制 `OPE/WHS/VEH/FAC/PRD/EMP/CUS/ACC/SUP/OTU/SLP-NNNN`；RPT 保留合法 slug 且新分配使用 `rpt-NNNNNN`；WFL 使用 `^[a-z][a-z0-9-]{1,62}[a-z0-9]$`。DCL 在创建 V1 时于同一 PostgreSQL transaction 分配 ID 与 code、创建 subject、中央 Approval V1 `DRAFT` 和完整 typed snapshot。删除尚未批准的 V1 会删除 subject 与 typed snapshot，但编码计数器不回退且 code 不复用。subject 不保存 `enabled`、Approval status、version number、revision 或 current pointer。

中央 Approval 继续唯一拥有版本号、状态、revision、审批元数据、事件、唯一开放候选和 highest `APPROVED` 选择规则。DCL typed snapshot 是每个 Approval Entry 的唯一业务 payload。BOB 是当前有效业务资料的只读查询域；每个实体以明确 typed SQL 连接 DCL subject、最高 `APPROVED` Approval Entry 和对应 typed snapshot，提供 `query`、`get` 与必要的 reference。系统不再物化 latest-approved BOB current、不在批准或反批时 apply/remove/rollback current，也不保存 stable-identity `objectRevision`。

Operating Entity、Warehouse、Vehicle、Fund Account 与 Product 首先按本决策收口：原 stable ID、code、Approval Entry、版本与历史 snapshot 原位保留；旧 BOB stable identity 与 current copy 结构物理删除。编码计数器从 BOB domain 收口到 DCL domain，并以两边原计数最大值为起点。Product formula、unit conversion、identifier claim、Vehicle carrier、Fund Account ownership 及全部历史精确引用继续使用强类型约束。

Party、Customer Account、Employee、Customer、Supplier、Other Unit 与 Sales Partner 随后按同一决策收口。`dcl_parties` 保存 Party 合并状态；各 `dcl_*_relationships` 与 `dcl_customer_accounts` 在 V1 批准前保存不可变的强类型关系边界，`dcl_subjects` 保存其 stable ID 与 business code。Party identifier claim、merge preflight、merge event 和关系冲突处理均由 DCL Party 专属实现持有。各实体的 latest-approved payload 只存在于 `dcl_*_versions`；旧 BOB identity、typed root、Party current/identifier 和各 1:1 current 结构均已物理删除。

报表定义同样按本决策终态收口：`dcl_subjects(entity=rpt-definition)` 原位保留既有 stable ID、code 与创建审计，Approval 原位保留 entry、version、revision 与事件，`dcl_rpt_definition_versions` 保存所有业务 snapshot（包括 `enabled`）。RPT 只以 `rpt_definition_validities(approvalEntryId)` 保存技术有效性，以 runtime audit 保存实际执行 entry；它不保存 definition root、root revision 或 current pointer。完成最终 cutover 后旧 BOB 通用身份表与 RPT stable root 均已物理删除，BOB current 只由 typed subject、highest APPROVED entry 与 snapshot 查询派生；BOB 编码计数命名空间已删除，迁入 DCL 的计数器保留原最大值且不回退，AUX 与 ACC 的独立计数命名空间不变。

流程定义也按同一身份边界收口：`dcl_subjects(entity=wfl-process-definition)` 唯一持有 stable ID、code 与创建审计，`wfl_definition_runtime_states` 只保存 `subjectId`、`enabled` 和更新审计。流程版本、实例与子单请求都经 runtime-state subjectId 保留 typed FK；运行审计继续保留历史 definition ID 与精确 Approval Entry，但不成为 identity root。旧 `wfl_process_definitions` 物理删除，不保留双根、兼容视图或双写。

V1 草稿在 BOB 不可见；V1 批准后无需额外写入即可被 BOB 读取；V2 `DRAFT` 或 `PENDING` 时仍读取 V1；V2 批准后读取 V2；V2 反批后自然回到 V1；V1 反批且无其他批准版本时自然不可见。已有业务按 stable ID 与精确 Approval Entry 校验历史来源，不要求该 entry 仍为 latest approved；持久化精确引用仍阻止不安全反批。

本 ADR 取代 ADR-0033 至 ADR-0042 中把 stable root 或 business code 归 BOB、要求 BOB 保存物化当前副本以及在 approve/unapprove 时同步维护该副本的条款，也取代 ADR-0046 中同类旧表述。上述 ADR 的强类型业务规则、DCL 写边界、Approval 所有权、页面边界、历史 snapshot 和精确引用规则继续有效。后续版本化实体必须沿同一所有权收口，不得建立改名的 stable root、current store、view、cache、fallback、兼容 alias 或通用 query engine。

对应 GitHub [#305](https://github.com/hansonyu183/zerp/issues/305)、核心 typed-master 切片 [#307](https://github.com/hansonyu183/zerp/issues/307)、Party/Relationship 切片 [#308](https://github.com/hansonyu183/zerp/issues/308)、RPT ownership 切片 [#309](https://github.com/hansonyu183/zerp/issues/309)、读取契约切片 [#310](https://github.com/hansonyu183/zerp/issues/310)、最终 cutover [#311](https://github.com/hansonyu183/zerp/issues/311) 与 WFL/编码不变量收口 [#316](https://github.com/hansonyu183/zerp/issues/316)。
