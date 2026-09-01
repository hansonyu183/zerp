---
id: ADR-0047
date: 2026-08-29
status: accepted
supersedes: ADR-0033, ADR-0034, ADR-0035, ADR-0036, ADR-0037, ADR-0039, ADR-0040, ADR-0041, ADR-0042
---

# DCL Subject 是版本化业务对象的唯一稳定身份

所有版本化业务对象统一以 `dcl_subjects` 作为唯一通用稳定身份。subject 保存不可变 stable ID、entity、business code 与创建审计信息；`(entity, upper(code))` 对非空 code 唯一。只有 ACC Mapping 是无编码 subject，允许 code 为空；Operating Entity、Warehouse、Vehicle、Fund Account、Product、Employee、Customer、Supplier、Other Unit、Sales Partner、RPT Definition 与 WFL Process Definition 的 code 必须非空并由数据库按 entity 校验格式。普通业务编码分别强制 `OPE/WHS/VEH/FAC/PRD/EMP/CUS/SUP/OTU/SLP-NNNN`；RPT 保留合法 slug 且新分配使用 `rpt-NNNNNN`；WFL 使用 `^[a-z][a-z0-9-]{1,62}[a-z0-9]$`。DCL 在创建 V1 时于同一 PostgreSQL transaction 分配 ID 与 code、创建 subject、中央 Approval V1 `DRAFT` 和完整 typed snapshot。删除尚未批准的 V1 会删除 subject 与 typed snapshot，但编码计数器不回退且 code 不复用。subject 不保存 `enabled`、Approval status、version number、revision 或 current pointer。

中央 Approval 继续唯一拥有版本号、状态、revision、审批元数据、事件、唯一开放候选和 highest `APPROVED` 选择规则。DCL typed snapshot 是每个 Approval Entry 的唯一业务 payload。BOB 只提供当前有效的只读业务资料；每个实体以明确 typed SQL 连接 DCL stable subject、最高 `APPROVED` Approval Entry 和对应 typed snapshot，提供 `query`、`get` 与必要的 reference。BOB 不物化资料副本，不参与批准或反批，也不保存 stable-identity `objectRevision`。

Operating Entity、Warehouse、Vehicle、Fund Account 与 Product 的 stable ID、code、Approval Entry、版本与历史 snapshot 均由 DCL 和中央 Approval 按上述边界持有。编码计数器位于 DCL domain，并保持单调且不复用。Product formula、unit conversion、identifier claim、Vehicle carrier、Fund Account ownership 及全部历史精确引用继续使用强类型约束。

Employee、Customer、Supplier、Other Unit 与 Sales Partner 各自采用独立 subject 边界，并在自己的 typed snapshot 中保存身份、强标识和业务属性；不存在共享 Party、relationship root、合并或跨类型标识同步。Customer 直接拥有身份、税务、开票、回款、默认经营主体及全部核算账户。核算账户只在 Customer 聚合内保存稳定 `accountId` 和客户内编码，不是 `dcl_subjects`、Approval subject、独立工作台或独立 current 实体；账户历史以 `customerId + accountId + customerApprovalEntryId` 精确定位。各实体的 latest-approved payload 只存在于对应 DCL typed snapshot；BOB 不持有第二套 identity 或 current 存储。

报表定义使用 `dcl_subjects(entity=rpt-definition)` 持有 stable ID、code 与创建审计，Approval 持有 entry、version、revision 与事件，`dcl_rpt_definition_versions` 保存所有业务 snapshot（包括 `enabled`）。RPT 只以 `rpt_definition_validities(approvalEntryId)` 保存技术有效性，以 runtime audit 保存实际执行 entry；它不保存 definition identity、revision 或 current pointer。BOB 只按 typed subject、highest APPROVED entry 与 snapshot 提供当前有效的只读业务资料；DCL 通用 counter 持有 RPT sequence，AUX 与 ACC 的独立计数命名空间不变。

流程定义也按同一身份边界收口：`dcl_subjects(entity=wfl-process-definition)` 唯一持有 stable ID、code 与创建审计，`wfl_definition_runtime_states` 只保存 `subjectId`、`enabled` 和更新审计。流程版本、实例与子单请求都经 runtime-state subjectId 保留 typed FK；运行审计继续保留历史 definition ID 与精确 Approval Entry，但不成为 identity root。旧 `wfl_process_definitions` 物理删除，不保留双根、兼容视图或双写。

V1 草稿在 BOB 不可见；V1 批准后无需额外写入即可被 BOB 读取；V2 `DRAFT` 或 `PENDING` 时仍读取 V1；V2 批准后读取 V2；V2 反批后自然回到 V1；V1 反批且无其他批准版本时自然不可见。已有业务按 stable ID 与精确 Approval Entry 校验历史来源，不要求该 entry 仍为 latest approved；持久化精确引用仍阻止不安全反批。

本 ADR 取代 front matter 所列 ADR 及 ADR-0046 中与本身份、资料和生命周期边界冲突的条款。上述 ADR 的强类型业务规则、DCL 写边界、Approval 所有权、页面边界、历史 snapshot 和精确引用规则继续有效。后续版本化实体必须沿同一所有权边界，不得建立第二 identity、current store、view、cache、fallback、兼容 alias 或通用 query engine。

对应 GitHub [#305](https://github.com/hansonyu183/zerp/issues/305)、核心 typed-master 切片 [#307](https://github.com/hansonyu183/zerp/issues/307)、RPT ownership 切片 [#309](https://github.com/hansonyu183/zerp/issues/309)、读取契约切片 [#310](https://github.com/hansonyu183/zerp/issues/310)、最终 cutover [#311](https://github.com/hansonyu183/zerp/issues/311)、WFL/编码不变量收口 [#316](https://github.com/hansonyu183/zerp/issues/316)、档案 clean cutover [#343](https://github.com/hansonyu183/zerp/issues/343)、Customer 聚合收口 [#344](https://github.com/hansonyu183/zerp/issues/344) 与类型化跨域引用 [#346](https://github.com/hansonyu183/zerp/issues/346)。
