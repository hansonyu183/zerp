# Architecture Decision Records

<!-- 此文件由 pnpm docs:adr-index 生成，请勿手工编辑。 -->

每份 ADR 的 frontmatter 与标题是此索引的唯一来源；现行领域规则和 HTTP 契约仍分别以 docs/domains/ 与 contracts/openapi/ 为准。

## Accepted

| ADR                                                                                   | 日期       | 决定                                                            |
| ------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------- |
| [ADR-0003](0003-starlark-workflow-definitions.md)                                     | 2026-08-09 | Use Starlark as the workflow definition source                  |
| [ADR-0004](0004-vou-approved-posting.md)                                              | 2026-08-09 | VOU 在审批时入账，批准是唯一终态                                |
| [ADR-0025](0025-rpt-permissions-are-app-managed-and-cross-book.md)                    | 2026-08-13 | RPT permissions are APP-managed and cross-book                  |
| [ADR-0026](0026-invalid-reports-stop-instead-of-falling-back.md)                      | 2026-08-13 | Invalid reports stop instead of falling back                    |
| [ADR-0027](0027-base-quantity-is-the-only-authoritative-quantity.md)                  | 2026-08-22 | Base quantity is the only authoritative quantity                |
| [ADR-0028](0028-order-history-delivery-specifications-and-standard-piece-quantity.md) | 2026-08-22 | Order-owned delivery specifications and standard piece quantity |
| [ADR-0029](0029-extensible-product-types-use-closed-behavior-profiles.md)             | 2026-08-22 | 可扩展产品类型绑定封闭行为模板                                  |
| [ADR-0031](0031-pay-is-deferred-and-requires-a-new-design.md)                         | 2026-08-23 | PAY 暂缓，未来从新输入模型重建                                  |
| [ADR-0032](0032-central-approval-persistence-and-lifecycle.md)                        | 2026-08-25 | 审批持久化、生命周期与版本头由中央 Approval 统一拥有            |
| [ADR-0043](0043-aux-stable-id-direct-crud.md)                                         | 2026-08-28 | AUX 使用 Stable-ID Direct CRUD 与采用方快照                     |
| [ADR-0044](0044-acc-mapping-declarations-are-dcl-owned.md)                            | 2026-08-28 | 会计映射申报由 DCL 拥有并投影到 ACC 当前记账解释                |
| [ADR-0045](0045-wfl-process-definition-declarations-are-dcl-owned.md)                 | 2026-08-29 | 流程定义申报由 DCL 拥有并供 WFL 当前执行                        |
| [ADR-0046](0046-dcl-is-the-only-approval-version-writer.md)                           | 2026-08-29 | DCL 是申报版本的唯一写入方                                      |
| [ADR-0047](0047-dcl-subject-is-the-stable-identity-authority.md)                      | 2026-08-29 | DCL Subject 是版本化业务对象的唯一稳定身份                      |
| [ADR-0048](0048-server-authoritative-approval-action-availability.md)                 | 2026-08-31 | Approval 动作资格由服务端中央决策                               |
| [ADR-0049](0049-typed-business-archives-replace-party.md)                             | 2026-09-01 | 强类型业务档案取代 Party 与关系层                               |
| [ADR-0050](0050-database-only-persists-facts.md)                                      | 2026-09-03 | 数据库只负责持久化，业务规则由 Domain Service 承担              |
| [ADR-0051](0051-shared-typescript-model-local-drafts-and-hono-cutover.md)             | 2026-09-03 | 共享 TypeScript 模型、本地 Draft 与 Hono 一次性切换             |

## Superseded

| ADR                                                                         | 日期       | 决定                                                 | 取代者                                                           |
| --------------------------------------------------------------------------- | ---------- | ---------------------------------------------------- | ---------------------------------------------------------------- |
| [ADR-0001](0001-other-dealings-subject-category.md)                         | 2026-08-09 | 其他往来台账采用主体与类别两个维度                   | [ADR-0030](0030-party-and-typed-business-relationships.md)       |
| [ADR-0002](0002-separate-payroll-ledger.md)                                 | 2026-08-09 | 工资使用独立计算、发放和台账                         | [ADR-0031](0031-pay-is-deferred-and-requires-a-new-design.md)    |
| [ADR-0030](0030-party-and-typed-business-relationships.md)                  | 2026-08-23 | Party 与强类型业务关系                               | [ADR-0049](0049-typed-business-archives-replace-party.md)        |
| [ADR-0033](0033-dcl-operating-entity-declaration-and-bob-read-boundary.md)  | 2026-08-27 | 经营主体由 DCL 申报并由 BOB 只读查询                 | [ADR-0047](0047-dcl-subject-is-the-stable-identity-authority.md) |
| [ADR-0034](0034-warehouse-declarations-are-dcl-owned.md)                    | 2026-08-27 | 仓库由 DCL 申报并由 BOB 只读查询                     | [ADR-0047](0047-dcl-subject-is-the-stable-identity-authority.md) |
| [ADR-0035](0035-vehicle-declarations-are-dcl-owned.md)                      | 2026-08-28 | 车辆由 DCL 申报并由 BOB 只读查询                     | [ADR-0047](0047-dcl-subject-is-the-stable-identity-authority.md) |
| [ADR-0036](0036-fund-account-declarations-are-dcl-owned.md)                 | 2026-08-28 | 资金账户由 DCL 申报并由 BOB 只读查询                 | [ADR-0047](0047-dcl-subject-is-the-stable-identity-authority.md) |
| [ADR-0037](0037-product-declarations-are-dcl-owned.md)                      | 2026-08-28 | 产品由 DCL 申报并由 BOB 只读查询                     | [ADR-0047](0047-dcl-subject-is-the-stable-identity-authority.md) |
| [ADR-0039](0039-employee-declarations-are-dcl-owned.md)                     | 2026-08-28 | 员工申报由 DCL 拥有并由 BOB 只读查询                 | [ADR-0047](0047-dcl-subject-is-the-stable-identity-authority.md) |
| [ADR-0040](0040-other-unit-and-sales-partner-declarations-are-dcl-owned.md) | 2026-08-28 | 服务关系与销售合作关系申报由 DCL 拥有                | [ADR-0047](0047-dcl-subject-is-the-stable-identity-authority.md) |
| [ADR-0041](0041-supplier-declarations-are-dcl-owned.md)                     | 2026-08-28 | 供应商申报由 DCL 拥有并由 BOB 只读查询               | [ADR-0047](0047-dcl-subject-is-the-stable-identity-authority.md) |
| [ADR-0042](0042-customer-declarations-are-dcl-owned.md)                     | 2026-08-28 | 客户与客户结算子账户申报由 DCL 拥有并由 BOB 只读查询 | [ADR-0047](0047-dcl-subject-is-the-stable-identity-authority.md) |

## Rejected

当前没有 rejected ADR。
