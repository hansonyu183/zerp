# 全仓文档审计与修复（2026-09-09）

## 范围和权威来源

审计基线为 `b6b0cccbd992703ff02ab01ae157f92d60535512`，开始时工作区干净。范围为仓库原有 118 份 Markdown，以及可执行契约、生成文档、索引、反向引用与文档门禁。适用根 `AGENTS.md` 和 `frontend/AGENTS.md`；未发现更深层文档约束。代码、配置、测试、CI 和业务契约均为只读证据。本记录是审计证据，不是第二套规格或部署证明。

业务规则以 `docs/domains/` 为权威，跨域词义由 `CONTEXT.md` 固定；ADR 解释批准的决定及替代范围。HTTP 由 `apps/api/` 可执行 Hono/Zod 路由拥有，生成 OpenAPI 不是手写规格。用例只描述页面编排。代码、注册表、配置与已有测试证明实现现状，不用于自动降低权威规格。

### 双向覆盖与证据

| 文档声明/公开面                  | 正向证据与反向文档归属                                                                                                             | 结论                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 领域实体、动作、状态、引用与事务 | 九份领域文档 ↔ `apps/api/src/{app,aux,bob,approval,vou,acc,wfl,rpt}` Service/contract、共享 model、`apps/api/db/target-schema.sql` | 静态核对；规则冲突见 U 项，不宣称全部业务场景执行通过                     |
| HTTP 与精确权限                  | 可执行 Hono 路由 ↔ `apps/api/src/generated/openapi.json`、`target-permission-catalog.json`、根 README                              | 生成物只读；本次没有协议变更，不重生成代码                                |
| 页面、资源、中文动作与异步隔离   | Router + Registry ↔ 18 个用例入口（5 个路由、13 个资源登记）、`COVERAGE.md`、六类页面运行时与 definitions                          | 修复旧逐页 VM 和单据录入现状描述；直接维护交互归导航用例，不另造重复用例  |
| CLI、环境变量、开发/发布/迁移    | 根 README、12 份 operations ↔ Makefile、package scripts、Compose、平台配置、迁移命令与 bootstrap                                   | 修复过早同步和开发端口；不能验证的完整旧基线迁移列 U2                     |
| 工具链、CI、生成器               | README ↔ packageManager/engines、Go module、`.github/workflows/`、`scripts/ci/classify.mjs`、`scripts/check-docs.mjs`              | 版本与命令静态核对；文档门禁现场运行                                      |
| Agent 规则、作用域、Issue 流程   | 两份 AGENTS、`docs/agents/` ↔ 真实目录、Hono/生成入口、gh CLI                                                                      | 修复无效 gh JSON 字段；无须另建 Agent 指令副本                            |
| ADR 与历史记录入口               | ADR frontmatter ↔ 原生 ADR 索引生成器；testing 文件 ↔ README/用例反链与 Git 历史                                                   | 补 ADR-0045/0058 部分替代关系及 10 条测试索引；没有删除无反链文件         |
| 外部/时间性声明                  | 文档引用的 GitHub Issues（另查 #366/#408/#412/#413）、SPA 与 API 健康地址                                                          | 32 个 Issue 可读取且均关闭；两个站点 HTTP 200。不是版本部署或业务验收证明 |

逐文件队列见附录。引用与反向引用队列已处理：本地链接由脚本及门禁核对；独立入口保留，测试归档补索引。生成队列仅 ADR 索引需要更新。覆盖队列中无法凭现有证据裁决的声明全部保留为 U 项；不把历史测试执行声明算作本次验证。

## 修复前 findings

位置以审计基线的章节和原句定位；行号随修复变化。

| ID  | 类别 / 严重度                   | 位置与原声明                                                                                                            | 证据、权威及处置                                                                                                         |
| --- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| F1  | factual drift / medium          | `frontend/README.md` 开头称其他页面持有 `vm.ts`                                                                         | ADR-0060、Registry、六类运行时；docs wrong，更新现状                                                                     |
| F2  | factual drift / medium          | 用例 README 称 Router 为唯一来源；状态/矩阵称独立 VouListPage、BOB/ACC 各自页面                                         | coverage 生成器同时读取 Registry；ResourceHost 绑定 definition；docs wrong，修复三份入口文档                             |
| F3  | factual drift / medium          | VOU「单据列表与详情」称其余 30 类未录入；ADR-0060 称居间链路待完成                                                      | 单据 definitions、DocumentPage、#412 与 2026-09-09 整改记录；docs wrong，改为 32 类并链接有日期证据                      |
| F4  | correctness error / medium      | 前端 API 运维文档把 `make dev` Web 说成 18083，并要求验证 DCL 页面                                                      | Makefile 的宿主 Vite、当前 Registry；docs wrong，区分 Vite 与 Compose Web，验收当前资源                                  |
| F5  | correctness error / high        | 人员、三档案、产品迁移手册称本组完成立即 `sync:catalog`，遗漏后续转换                                                   | `sync-target-catalog.ts` 与 bootstrap 保护、客户/RPT/WFL/期初迁移；docs wrong，删除虚假的完整顺序及提前同步，U2 仍未解决 |
| F6  | semantic inconsistency / medium | BOB「统一身份」「并发」仍称 Customer 版本化整体停用、WFL 无独立 revision                                                | ADR-0055/0058、BOB 客户末节、WFL 第 2 节；docs wrong，修复并引用所属领域                                                 |
| F7  | redundancy / low                | BOB 重复 Customer、五类写四类、车辆重复边界及仅三类验收                                                                 | 本文五类所有权与 ADR-0055；docs wrong，最小文字修正                                                                      |
| F8  | semantic inconsistency / medium | AUX 引用表称客户核算账户、员工类别称已批准员工；CONTEXT 身份词义泛称员工审批/版本；VOU 3.7 要求 Employee Approval Entry | ADR-0053、AUX current 规则与 CONTEXT 客户子单位；docs wrong，统一当前归属与采用快照                                      |
| F9  | factual drift / medium          | ACC 第 1 节 RPT 待办/投影，第 10 节要求已批准映射                                                                       | ADR-0056/0057、RPT 与 ACC 当前映射规则；docs wrong，指向事实查询与当前映射                                               |
| F10 | index/gate mismatch / low       | ADR-0045 未记录被 ADR-0058 部分替代                                                                                     | ADR-0058 明确改属 WFL 并增加 runtime revision；docs wrong，补双向 metadata 和替代范围，原生生成索引                      |
| F11 | correctness error / high        | 供应商用例「提交资料版本」允许未知提交未找到后重试                                                                      | ADR-0060、VersionPage 的 pending 核实逻辑；docs wrong，未找到保持锁定（不改变删除成功核实规则）                          |
| F12 | orphan/entry-point issue / low  | testing README 遗漏 10 个已追踪验收记录                                                                                 | 文件及反链检查证实为历史证据；docs wrong，补链接，保留原记录                                                             |
| F13 | correctness error / low         | issue-tracker 的 `gh pr list --json authorAssociation`                                                                  | 当前 gh 返回 Unknown JSON field；docs wrong，改用只读 REST pulls 的 `author_association`                                 |

## 修改摘要

修复 F1–F13，未改业务代码、运行配置、测试、门禁或 CI。唯一更新的既有生成文档是 `docs/adr/README.md`，来源命令为 `pnpm docs:adr-index`。新增本审计记录并加入 testing 索引。既有历史验收报告正文、过往 ADR 决定正文及旧切换证据保留。

## 复审结果

采用 **同 Agent 二次复核**。复核整份 diff、相关 Registry、VersionPage 未知提交核实、迁移保护与领域规则。首轮纠正了新增 WFL 锚点，并用 Prettier 修正两份文档格式；补查词汇表和员工借款后，统一了 AUX 员工 current 身份。没有通过修改文档消除下面的实现偏差。初始工作区无既有修改；最终修改边界仅 Markdown。

## 验证命令及结果

- `pnpm docs:adr-index`：最终通过；首次发现新增锚点错误，修正后重新生成并通过。
- `pnpm docs:check`：最终通过（119 份 Markdown、9 个领域、12 份手册、18 个页面入口，9 项测试）。
- `pnpm format:check`：首轮 AUX/BOB 格式失败，已定向格式化；最终 `make check-common` 通过全仓格式、文档检查和 diff 检查。
- `gh pr list --json authorAssociation --limit 1`：预期失败，确认原示例不可执行。`gh api 'repos/hansonyu183/zerp/pulls?state=open&per_page=100' --paginate` 及使用 `{owner}/{repo}` 占位符筛选 `author_association` 的只读查询通过。
- `git diff --check`、最终格式/文档门禁和生成索引只读一致性：通过；索引仅由原生生成器更新。
- 本地 Markdown 目标路径检查：原有 118 份零缺失；锚点另由原生门禁验证。外部 GitHub Issue 可达性和两站点 HTTP 状态已检查。
- `make generate`、业务/E2E、数据库迁移及部署：not-run。本次只有文档修复；总生成命令涉及业务生成物和隔离数据库，不在可写范围。没有把既有验收记录当作本次测试结果。

## 未解决项

| ID  | 类别 / 严重度 / 判断                                                            | 位置与证据                                                                                                                                                              | 处置                                                                                                       |
| --- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| U1  | correctness error / high / implementation wrong                                 | APP 第 10 节要求密码最小值配置 8–128 和两个登录锁定环境变量；`platform/config.ts` 只检查正整数，未读取锁定变量；`app/session.ts` 仅从注入配置或固定 5 次/15 分钟取值    | 保留规格；需代码修复和公共配置/登录行为验证，本次不修改                                                    |
| U2  | correctness error / high / implementation wrong（静态条件成立，整库结果未实测） | `app/bootstrap.ts` 的 `migratePermissionCatalogInTransaction` 在旧 ACC opening grant 存在且本次无 opening mapping 时直接拒绝；早期 AUX/BOB 迁移调用同一函数             | 修复手册的无条件顺序，但不能据此宣称完整迁移可执行；需匹配旧基线的端到端迁移验证，不直接倒置步骤或绕过保护 |
| U3  | factual drift / medium / unresolved                                             | 无当前调用方的 `compose.e2e.yaml` 仍引用不存在的 `backend` 和旧 Go bootstrap/seed 二进制；当前 Make 使用 `compose.target.yaml`                                          | 运行配置只读，保留并报告清理候选；没有启动该配置                                                           |
| U4  | semantic inconsistency / high / unresolved                                      | VOU 第 5 节要求一次性上传 URL，而 `vou/contract.ts` attachment-stage 接受 contentBase64；`vou/service.ts` 暂存写盘发生在数据库事务内，与第 6 节事务副作用要求需对照裁决 | 不把权威上传/事务规则改成现有代码；需明确协议和暂存副作用边界并验证失败清理                                |
| U5  | semantic inconsistency / medium / unresolved                                    | VOU 固定资产段称首版无历史资产期初、按控制账簿折旧，与 ACC 第 6/12 节期初资产及各账簿折旧冲突；ACC 期间段仍枚举保存/检查/反检查，与不可变 Submission 生命周期不一致     | 需领域裁决具体业务流程及适用范围，不批量替换动作词                                                         |
| U6  | semantic inconsistency / medium / unresolved                                    | AUX 结算方式要求供应商快照加价固定零，而 BOB 供应商只保存 ID/编码/名称/termCode/rule；BOB AUX 通则仅验证采用时 current，客户类型条款却要求批准时重新验证启用            | 保留原文并列出冲突；需决定快照字段与后续批准时的引用规则                                                   |
| U7  | coverage gap / low / unresolved                                                 | 原文档门禁通过，但未发现 testing 索引漏项及页面现状语义漂移                                                                                                             | 索引已修；没有授权修改门禁及其测试，不扩张为通用语义检查工程                                               |

本次没有启动需要保留的服务、隧道或开发服务器；只读查询与检查进程均在任务内结束。未提交、推送或发布。

## 逐文件审计清单

`audited` 表示已做静态内容、错误/漂移/重复、入口关系和归属覆盖检查，不表示执行全部业务场景。`audited/archive` 表示审查历史定位、链接和入口；历史环境、执行结果及当时部署真实性的重新演练为 `excluded`，原因是带日期记录且无对应现场环境。本清单列原有 118 份文件；生成的 OpenAPI/权限 JSON、用例缺口 baseline JSON、LICENSE 另作只读证据，不维护第二份正文。

| 文件（仓库相对路径）                                                                 | 状态                               |
| ------------------------------------------------------------------------------------ | ---------------------------------- |
| `AGENTS.md`                                                                          | audited                            |
| `CONTEXT.md`                                                                         | audited                            |
| `README.md`                                                                          | audited                            |
| `apps/api/tests/migrations/baselines/README.md`                                      | audited                            |
| `docs/adr/0001-other-dealings-subject-category.md`                                   | audited                            |
| `docs/adr/0002-separate-payroll-ledger.md`                                           | audited                            |
| `docs/adr/0003-starlark-workflow-definitions.md`                                     | audited                            |
| `docs/adr/0004-vou-approved-posting.md`                                              | audited                            |
| `docs/adr/0025-rpt-permissions-are-app-managed-and-cross-book.md`                    | audited                            |
| `docs/adr/0026-invalid-reports-stop-instead-of-falling-back.md`                      | audited                            |
| `docs/adr/0027-base-quantity-is-the-only-authoritative-quantity.md`                  | audited                            |
| `docs/adr/0028-order-history-delivery-specifications-and-standard-piece-quantity.md` | audited                            |
| `docs/adr/0029-extensible-product-types-use-closed-behavior-profiles.md`             | audited                            |
| `docs/adr/0030-party-and-typed-business-relationships.md`                            | audited                            |
| `docs/adr/0031-pay-is-deferred-and-requires-a-new-design.md`                         | audited                            |
| `docs/adr/0032-central-approval-persistence-and-lifecycle.md`                        | audited                            |
| `docs/adr/0033-dcl-operating-entity-declaration-and-bob-read-boundary.md`            | audited                            |
| `docs/adr/0034-warehouse-declarations-are-dcl-owned.md`                              | audited                            |
| `docs/adr/0035-vehicle-declarations-are-dcl-owned.md`                                | audited                            |
| `docs/adr/0036-fund-account-declarations-are-dcl-owned.md`                           | audited                            |
| `docs/adr/0037-product-declarations-are-dcl-owned.md`                                | audited                            |
| `docs/adr/0039-employee-declarations-are-dcl-owned.md`                               | audited                            |
| `docs/adr/0040-other-unit-and-sales-partner-declarations-are-dcl-owned.md`           | audited                            |
| `docs/adr/0041-supplier-declarations-are-dcl-owned.md`                               | audited                            |
| `docs/adr/0042-customer-declarations-are-dcl-owned.md`                               | audited                            |
| `docs/adr/0043-aux-stable-id-direct-crud.md`                                         | audited                            |
| `docs/adr/0044-acc-mapping-declarations-are-dcl-owned.md`                            | audited                            |
| `docs/adr/0045-wfl-process-definition-declarations-are-dcl-owned.md`                 | audited                            |
| `docs/adr/0046-dcl-is-the-only-approval-version-writer.md`                           | audited                            |
| `docs/adr/0047-dcl-subject-is-the-stable-identity-authority.md`                      | audited                            |
| `docs/adr/0048-server-authoritative-approval-action-availability.md`                 | audited                            |
| `docs/adr/0049-typed-business-archives-replace-party.md`                             | audited                            |
| `docs/adr/0050-database-only-persists-facts.md`                                      | audited                            |
| `docs/adr/0051-shared-typescript-model-local-drafts-and-hono-cutover.md`             | audited                            |
| `docs/adr/0052-session-dynamic-navigation-and-page-migration.md`                     | audited                            |
| `docs/adr/0053-aux-current-people-and-temporary-input.md`                            | audited                            |
| `docs/adr/0054-aux-current-assets.md`                                                | audited                            |
| `docs/adr/0055-bob-archives-use-shared-approval-and-version.md`                      | audited                            |
| `docs/adr/0056-acc-current-mapping.md`                                               | audited                            |
| `docs/adr/0057-rpt-current-definition.md`                                            | audited                            |
| `docs/adr/0058-wfl-owns-versioned-definitions.md`                                    | audited                            |
| `docs/adr/0059-vou-accounting-opening.md`                                            | audited                            |
| `docs/adr/0060-dynamic-page-runtime.md`                                              | audited                            |
| `docs/adr/README.md`                                                                 | audited                            |
| `docs/agents/domain.md`                                                              | audited                            |
| `docs/agents/issue-tracker.md`                                                       | audited                            |
| `docs/agents/triage-labels.md`                                                       | audited                            |
| `docs/domains/acc.md`                                                                | audited                            |
| `docs/domains/app.md`                                                                | audited                            |
| `docs/domains/approval.md`                                                           | audited                            |
| `docs/domains/aux.md`                                                                | audited                            |
| `docs/domains/bob.md`                                                                | audited                            |
| `docs/domains/dcl.md`                                                                | audited                            |
| `docs/domains/rpt.md`                                                                | audited                            |
| `docs/domains/vou.md`                                                                | audited                            |
| `docs/domains/wfl.md`                                                                | audited                            |
| `docs/operations/acc-mapping-migration.md`                                           | audited                            |
| `docs/operations/aux-people-migration.md`                                            | audited                            |
| `docs/operations/bob-archives-migration.md`                                          | audited                            |
| `docs/operations/bob-customer-migration.md`                                          | audited                            |
| `docs/operations/bob-product-migration.md`                                           | audited                            |
| `docs/operations/frontend-api-configuration.md`                                      | audited                            |
| `docs/operations/issue-366-cutover-runbook.md`                                       | audited                            |
| `docs/operations/menu-structure-cleanup.md`                                          | audited                            |
| `docs/operations/rpt-definition-migration.md`                                        | audited                            |
| `docs/operations/user-pinyin-backfill.md`                                            | audited                            |
| `docs/operations/vou-opening-migration.md`                                           | audited                            |
| `docs/operations/wfl-definition-migration.md`                                        | audited                            |
| `docs/testing/README.md`                                                             | audited                            |
| `docs/testing/aux-management-issue-386-2026-09-06.md`                                | audited/archive；历史执行 excluded |
| `docs/testing/aux-people-issue-394-2026-09-07.md`                                    | audited/archive；历史执行 excluded |
| `docs/testing/direct-maintenance-issue-409-2026-09-08.md`                            | audited/archive；历史执行 excluded |
| `docs/testing/dynamic-fields-issue-393-2026-09-07.md`                                | audited/archive；历史执行 excluded |
| `docs/testing/dynamic-pages-issue-413-2026-09-09.md`                                 | audited/archive；历史执行 excluded |
| `docs/testing/dynamic-pages-review-fixes-2026-09-09.md`                              | audited/archive；历史执行 excluded |
| `docs/testing/first-slice-integration-issue-382-2026-09-06.md`                       | audited/archive；历史执行 excluded |
| `docs/testing/full-functional-test-2026-08-31.md`                                    | audited/archive；历史执行 excluded |
| `docs/testing/full-functional-test-remediation-2026-08-31.md`                        | audited/archive；历史执行 excluded |
| `docs/testing/issue-400-rpt.md`                                                      | audited/archive；历史执行 excluded |
| `docs/testing/issue-401-wfl.md`                                                      | audited/archive；历史执行 excluded |
| `docs/testing/measurement-unit-issue-387-2026-09-06.md`                              | audited/archive；历史执行 excluded |
| `docs/testing/navigation-host-issue-380-2026-09-06.md`                               | audited/archive；历史执行 excluded |
| `docs/testing/payment-method-issue-388-2026-09-06.md`                                | audited/archive；历史执行 excluded |
| `docs/testing/role-management-issue-385-2026-09-06.md`                               | audited/archive；历史执行 excluded |
| `docs/testing/second-batch-integration-issue-390-2026-09-07.md`                      | audited/archive；历史执行 excluded |
| `docs/testing/session-contract-issue-379-2026-09-06.md`                              | audited/archive；历史执行 excluded |
| `docs/testing/third-batch-integration-issue-405-2026-09-08.md`                       | audited/archive；历史执行 excluded |
| `docs/testing/user-list-issue-381-2026-09-06.md`                                     | audited/archive；历史执行 excluded |
| `docs/testing/version-archives-issue-410-2026-09-09.md`                              | audited/archive；历史执行 excluded |
| `docs/testing/vou-catalog-issue-403-2026-09-08.md`                                   | audited/archive；历史执行 excluded |
| `docs/testing/vou-document-pages-issue-411-2026-09-09.md`                            | audited/archive；历史执行 excluded |
| `docs/testing/vou-entry-issue-412-2026-09-09.md`                                     | audited/archive；历史执行 excluded |
| `docs/testing/vou-order-pages-issue-402-2026-09-08.md`                               | audited/archive；历史执行 excluded |
| `docs/testing/wfl-starlark-parity-issue-361.md`                                      | audited/archive；历史执行 excluded |
| `docs/use-cases/COVERAGE.md`                                                         | audited                            |
| `docs/use-cases/FRONTEND-RESTORATION-STATUS.md`                                      | audited                            |
| `docs/use-cases/PAGE-CAPABILITY-MATRIX.md`                                           | audited                            |
| `docs/use-cases/README.md`                                                           | audited                            |
| `docs/use-cases/acc/mapping-management.md`                                           | audited                            |
| `docs/use-cases/app/change-password.md`                                              | audited                            |
| `docs/use-cases/app/forbidden.md`                                                    | audited                            |
| `docs/use-cases/app/navigation.md`                                                   | audited                            |
| `docs/use-cases/app/not-found.md`                                                    | audited                            |
| `docs/use-cases/app/signin.md`                                                       | audited                            |
| `docs/use-cases/bob/customer-management.md`                                          | audited                            |
| `docs/use-cases/bob/other-unit-management.md`                                        | audited                            |
| `docs/use-cases/bob/product-management.md`                                           | audited                            |
| `docs/use-cases/bob/sales-partner-management.md`                                     | audited                            |
| `docs/use-cases/bob/supplier-management.md`                                          | audited                            |
| `docs/use-cases/rpt/report-query.md`                                                 | audited                            |
| `docs/use-cases/vou/catalog.md`                                                      | audited                            |
| `docs/use-cases/vou/opening.md`                                                      | audited                            |
| `docs/use-cases/vou/purchase-order.md`                                               | audited                            |
| `docs/use-cases/vou/sale-order.md`                                                   | audited                            |
| `docs/use-cases/wfl/process-definition.md`                                           | audited                            |
| `docs/use-cases/wfl/process-instance.md`                                             | audited                            |
| `frontend/AGENTS.md`                                                                 | audited                            |
| `frontend/README.md`                                                                 | audited                            |
