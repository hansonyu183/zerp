# #416 字段与录入操作验收

2026-09-10 完成本片。实现候选 SHA：`f4eb6c37718c5775de359d96b3239bd25d15e320`。本记录与用例证据链接的后续提交仅修改文档，复用该候选的代码验证结果。

范围见 [#416](https://github.com/hansonyu183/zerp/issues/416)、[ADR-0060](../adr/0060-dynamic-page-runtime.md) 和[公共字段与录入操作](../use-cases/field-entry.md)。未执行生产部署、业务数据迁移或远端发布。

## 实现与回归

FieldInput 统一标量输入；FormBlock 组合字段与引用，EditForm 持有提交事件，DynamicForm 保留筛选范围和显式查询。全部六类页面的普通字段消费者已迁移；公共字段、表单及引用能力归入 dynamic-fields，旧路径已删除。产品单位空值由业务模块声明。ACC 自由匹配值集合保留专用组合框。

复用真实 definition → Registry/Host → 页面操作 → 类型化 API 的测试。新增真实 Vuetify 测试覆盖无局部提交表单、未完成整数、字符串精度与清空、多行/密码/布尔/条件显示/只读、已有停用角色回显及显式移除、IME、真实计量单位保存及明暗主题图标。初始回归先复现了局部表单问题；迁移期间清空按钮回归也经失败测试验证后修复。已有查询快照、并行引用、迟到响应、Session 切换、未知结果锁与仅导出权限测试均通过。

## 命令与结果

| 命令                                                                                           | 退出码 | 结果                                                                            |
| ---------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------- |
| `make check-common`                                                                            | 0      | 格式、文档与差异检查通过                                                        |
| `make --silent check-ci-workflow`                                                              | 0      | 工作流检查通过                                                                  |
| `pnpm --filter @zerp/frontend typecheck`                                                       | 0      | 字段及消费者类型通过                                                            |
| `pnpm --filter @zerp/frontend lint`                                                            | 0      | lint 通过                                                                       |
| `pnpm --filter @zerp/frontend build:target`                                                    | 0      | SPA 构建通过                                                                    |
| `pnpm --filter @zerp/frontend test:unit`                                                       | 0      | 常规 244 项、真实 Vuetify 配置 17 项通过                                        |
| `make --silent target-e2e TARGET_COMPOSE='docker compose -p zerp-416 -f compose.target.yaml'`  | 0      | 生成一致性、WFL parity、模型/API 检查与真实 PostgreSQL 测试、全部浏览器专项通过 |
| `make --silent target-down TARGET_COMPOSE='docker compose -p zerp-416 -f compose.target.yaml'` | 0      | 独占环境回收                                                                    |

完整门禁使用受控环境注入独占端口：PostgreSQL 55616、API 18416、Web 18417；浏览器 API 地址和 CORS 均指向同一隔离环境。未使用默认共享项目，也未访问公网业务数据库。测试数据由仓库支持的业务操作准备。

业务浏览器共 99 项：通用 28、WFL 1、单据目录 2、期初 2、逐类录入 66。覆盖全部 32 类人工录入单据的真实入口、候选、提交、持久化回读及克隆；WFL WASM 浏览器 parity 另行通过。

## 窄屏与主题证据

资产购入、收票、销售收款分别在 1280px/390px、浅色/深色主题生成截图，共 12 张，位于本地 `.scratch/issue-416/{asset-acquisition,bill-receipt,sales-receipt}-{1280,390}-{light,dark}.png`。浏览器同时检查添加、移除、提交图标的装饰性语义及真实提交行为。人工检查六张代表截图：各类字段和明细按钮可读，长表单通过既有滚动容器触达后续字段与提交。

用户编辑器另有两种宽度、两种主题的截图，位于本地 `.scratch/issue-381-user/`；检查了桌面浅色和 390px 深色编辑器。关键操作保持中文名称，图标不重复朗读。截图及原始日志为本地测试工件，不提交附件或测试数据。

## Standards

独立审查发现 ACC 固定资产配置布尔字段遗漏公共输入，已修复并复核。未发现剩余标准违反或需处理的设计问题。

## Spec

独立审查确认同一遗漏已修复；其余本片范围未发现具体缺项、行为回归或范围扩大。

Standards：0 项遗留；Spec：0 项遗留。

## 收尾

已回读确认 `zerp-416` 的容器、卷和网络均不存在，并删除本票临时凭证环境文件。原有共享服务未关闭。用户原有跟踪文件修改与开始时的差异一致，未混入实现提交；原有未跟踪文档保留。
