---
id: ADR-0047
date: 2026-08-29
status: accepted
supersedes: ADR-0033, ADR-0034, ADR-0035, ADR-0036, ADR-0037
---

# DCL Subject 是版本化业务对象的唯一稳定身份

所有版本化业务对象统一以 `dcl_subjects` 作为唯一通用稳定身份。subject 保存不可变 stable ID、entity、可空 business code 与创建审计信息；非空 `(entity, code)` 唯一。DCL 在创建 V1 时于同一 PostgreSQL transaction 分配 ID 与 code、创建 subject、中央 Approval V1 `DRAFT` 和完整 typed snapshot。删除尚未批准的 V1 会删除 subject 与 typed snapshot，但编码计数器不回退且 code 不复用。subject 不保存 `enabled`、Approval status、version number、revision 或 current pointer。

中央 Approval 继续唯一拥有版本号、状态、revision、审批元数据、事件、唯一开放候选和 highest `APPROVED` 选择规则。DCL typed snapshot 是每个 Approval Entry 的唯一业务 payload。BOB 是当前有效业务资料的只读查询域；每个实体以明确 typed SQL 连接 DCL subject、最高 `APPROVED` Approval Entry 和对应 typed snapshot，提供 `query`、`get` 与必要的 reference。系统不再物化 latest-approved BOB current、不在批准或反批时 apply/remove/rollback current，也不保存 stable-identity `objectRevision`。

Operating Entity、Warehouse、Vehicle、Fund Account 与 Product 首先按本决策收口：原 stable ID、code、Approval Entry、版本与历史 snapshot 原位保留；`bob_operating_entities`、`bob_warehouses`、`bob_vehicles`、`bob_fund_accounts` 与 `bob_products` 删除；它们在 `bob_objects` 中的 identity 行迁入 `dcl_subjects` 后删除。编码计数器从 BOB domain 收口到 DCL domain，并以两边原计数最大值为起点。Product formula、unit conversion、identifier claim、Vehicle carrier、Fund Account ownership 及全部历史精确引用继续使用强类型约束。

V1 草稿在 BOB 不可见；V1 批准后无需额外写入即可被 BOB 读取；V2 `DRAFT` 或 `PENDING` 时仍读取 V1；V2 批准后读取 V2；V2 反批后自然回到 V1；V1 反批且无其他批准版本时自然不可见。已有业务按 stable ID 与精确 Approval Entry 校验历史来源，不要求该 entry 仍为 latest approved；持久化精确引用仍阻止不安全反批。

本 ADR 取代 ADR-0033 至 ADR-0037 中“stable root 或 business code 归 BOB”“BOB 保存 current projection”以及“approve/unapprove 同事务 apply/remove/rollback current”的条款，也取代 ADR-0046 中“BOB 保存 current projection”的表述。上述 ADR 的强类型业务规则、DCL 写边界、Approval 所有权、页面边界、历史 snapshot 和精确引用规则继续有效。后续版本化实体必须沿同一所有权收口，不得建立改名的 stable root、current store、view、cache、fallback、兼容 alias 或通用 query engine。

对应 GitHub [#305](https://github.com/hansonyu183/zerp/issues/305) 与首个核心 typed-master 切片 [#307](https://github.com/hansonyu183/zerp/issues/307)。
