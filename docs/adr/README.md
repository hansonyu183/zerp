# Architecture Decision Records

每份 ADR 使用固定 frontmatter：`id`、`date`、`status`；已取代的 ADR 还记录 `superseded_by`，取代其他 ADR 的记录使用 `supersedes`。现行领域规则和 HTTP 契约仍分别以 `docs/domains/` 与 `contracts/openapi/` 为准。

## Accepted

| ADR                                                                                   | 日期       | 决定                       |
| ------------------------------------------------------------------------------------- | ---------- | -------------------------- |
| [ADR-0003](0003-starlark-workflow-definitions.md)                                     | 2026-08-09 | WFL 定义来源               |
| [ADR-0004](0004-vou-approved-posting.md)                                              | 2026-08-09 | VOU 审批入账               |
| [ADR-0025](0025-rpt-permissions-are-app-managed-and-cross-book.md)                    | 2026-08-13 | RPT 权限归 APP 管理        |
| [ADR-0026](0026-invalid-reports-stop-instead-of-falling-back.md)                      | 2026-08-13 | 无效报表停止执行           |
| [ADR-0027](0027-base-quantity-is-the-only-authoritative-quantity.md)                  | 2026-08-22 | 基准数量唯一权威           |
| [ADR-0028](0028-order-history-delivery-specifications-and-standard-piece-quantity.md) | 2026-08-22 | 订单交付规格与标准件数量   |
| [ADR-0029](0029-extensible-product-types-use-closed-behavior-profiles.md)             | 2026-08-22 | 产品类型绑定封闭行为模板   |
| [ADR-0030](0030-party-and-typed-business-relationships.md)                            | 2026-08-23 | Party 与强类型业务关系     |
| [ADR-0031](0031-pay-is-deferred-and-requires-a-new-design.md)                         | 2026-08-23 | PAY 暂缓并从新输入模型重建 |

## Superseded

| ADR                                                 | 日期       | 取代者                                                        |
| --------------------------------------------------- | ---------- | ------------------------------------------------------------- |
| [ADR-0001](0001-other-dealings-subject-category.md) | 2026-08-09 | [ADR-0030](0030-party-and-typed-business-relationships.md)    |
| [ADR-0002](0002-separate-payroll-ledger.md)         | 2026-08-09 | [ADR-0031](0031-pay-is-deferred-and-requires-a-new-design.md) |

## Rejected

当前没有 rejected ADR。
