# 辅助 GET 第一片验收（#426）

## 候选与范围

- 完整运行时验收后仅补充本记录、测试索引和迁移盘点的实体闭集/订单历史读取场景；无运行代码或生成物变更。
- 实现候选：`2ed59d0f8e10fc8601c44862bbc5bb57969a62d5`，隔离集成分支 `codex/425-get-auxiliary-reads`。
- 规格：[本片 #426](https://github.com/hansonyu183/zerp/issues/426)、[父规格 #425](https://github.com/hansonyu183/zerp/issues/425)。全量基线、消费者与后续范围见[迁移矩阵](auxiliary-read-migration-matrix.md)。
- 本片仅替换 ACC mapping catalog。旧 POST、动作权限、前端权限依赖与专属旧断言删除；其余辅助读取在后续切片完成。本片不发布生产，不关闭父规格。
- 方法规则及逐项例外见 [ADR-0061](../adr/0061-action-post-auxiliary-get.md)，保持 [ADR-0060](../adr/0060-dynamic-page-runtime.md) 的公共页面所有权。

## 可观察接缝与验收

| 父规格编号 | 本片证据                                                                                                 | 结果与边界                                                                                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-01      | `app-session-user-query.int.test.ts` 经真实 HTTP、Session、PostgreSQL 请求 catalog                       | 无会话、过期、停用、强制改密拒绝；不返回目录                                                                                                                                  |
| AC-02、03  | 同一有效用户在无 mapping 动作授权时 GET；随后调用正式 POST                                               | GET 无 CSRF 成功；query/get/save 无动作权限拒绝；有 query 权限但无 CSRF 仍拒绝                                                                                                |
| AC-04      | `target-artifacts.test.ts` 的公开 `validateTargetRouteMetadata`                                          | GET 动作权限、GET 同路径能力、普通 POST 漏权限、缺漏/重复/额外元数据拒绝；逐项平台例外和既有分派能力保留                                                                      |
| AC-05      | `permission-catalog.int.test.ts` 经 BootstrapService 同步、Session 登录及认证                            | 保留无关权限 ID、状态、授权；删除 catalog 及角色关联，推进相关角色 revision 并撤销旧 Session；仅有 catalog 的用户重新登录后 apiPaths 为空；重复同步保留新 Session 和 revision |
| AC-06      | `configuration-page.component.spec.ts` 经真实 Registry → ResourceHost → ConfigurationPage → MappingBlock | 只有 save 权限仍能直达并加载目录、打开编辑器；不请求无权 query/get；沿用 Session 导航规则                                                                                     |
| AC-15      | 真实 HTTP 读取目录、拒绝其他所有者账簿的 POST query/get；存续 ACC 集成与保存回归                         | GET 只列出既有可查询账簿，正式保存权限和账簿操作范围不变；本片不覆盖 RPT/角色候选迁移                                                                                         |
| AC-16      | HTTP get → catalog GET → get 比较当前映射                                                                | 稳定身份、revision、完整配置不变；目录服务仅查询业务表，Session 技术活跃时间更新保留                                                                                          |
| AC-17      | catalog GET 带未登记 query 参数                                                                          | 稳定 `validation_failed` 包络；本接口没有数字/布尔/数组参数，相关后续候选解析不在本片宣称通过                                                                                 |
| AC-18、19  | 真实 HTTP 旧 POST 返回 404；推导 `$get` 客户端、Host 与 `acc-mapping.spec.ts`                            | 无重定向/fallback；浏览器观察 GET 方法且无 CSRF，Session 不含 catalog；正式保存及移动端编辑流程保持                                                                           |

红绿过程：生成方法分类测试先因未抛出异常失败；去除测试用户 catalog 权限后原 Host 测试失败；目录删除回归先因角色 revision 仍为 1 失败。分别完成实现后通过。新增前端失败重试场景通过实际 Host 按钮重试，不把错误伪装为空目录。

## 命令与结果

数据库验证只使用本会话创建的独占 `zerp-target` 可丢弃 PostgreSQL，真实 HTTP 使用测试创建的本机随机端口服务。连接信息在进程环境中注入，不记录凭证。下列聚合入口使用仓库现有流程，没有另建验收体系。

| 命令                                                                                                                                                       | 退出码 | 证据                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `make generate`                                                                                                                                            | 0      | 从 Hono 生成 GET 契约与无 catalog 权限目录，重建独占数据库并生成类型；无业务 schema 变更                                                                 |
| `make check`                                                                                                                                               | 0      | 文档、格式、架构、生成工具、各包类型、lint、CI 工具检查                                                                                                  |
| `node --test --test-concurrency=1 apps/api/tests/integration/permission-catalog.int.test.ts apps/api/tests/integration/app-session-user-query.int.test.ts` | 0      | 4 项真实 Session/HTTP/目录同步集成通过                                                                                                                   |
| `pnpm --filter @zerp/frontend exec vitest run --config vitest.config.ts tests/unit/target/configuration-page.component.spec.ts`                            | 0      | 7 项真实 Host/配置编辑器组件场景通过                                                                                                                     |
| `make e2e`                                                                                                                                                 | 0      | 104 项真实 PostgreSQL 集成；五组浏览器 27 + 1 + 2 + 2 + 66 = 98 项通过；WFL Node/browser parity、单元/组件、生成、静态、编排 CLI 与 Compose 构建全部通过 |

## 独立审查

Standards 与 Spec 分别独立只读审查。Standards 无可操作问题；Spec 发现迁移盘点误把函数后的类型引用计为前一个函数调用，已改按 TypeScript AST 函数体提取并重生成全表，复核候选后关闭该 finding。最终两轴均无未解决问题。

## 资源回收与未执行项

`make target-down` 退出 0，回读确认本会话 `zerp-target` 容器、卷、网络均为空，宿主机 18082、18083、55439 无监听。验收 runner 已正常退出，临时 HTTP 服务与 Playwright 浏览器由各 runner 收尾关闭。任务开始时已存在的 `zerp-back-web-1`、`zerp-back-api-1`、`zerp-back-db-1` 为共享资源，不由本会话停止。

未执行生产发布、生产健康或生产镜像清理。本片不宣称父规格 AC-07–14、AC-20 或其余实体辅助读取迁移完成。
