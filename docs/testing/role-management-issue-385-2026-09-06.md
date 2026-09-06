# 2026-09-06 #385 公共启停与角色管理验证记录

范围为父规格 #384 的第一片：公共启停先接入用户，再接入角色；角色原生协议、角色页及用户角色直接消费者同步切换。基线为 `58bee225c1d2607e2cee00a7c8bf3c5ce8569f0d`，工作分支为 `codex/issue-385-role-management`。本记录不代表 #385 已完成全部验收，也不代表合并、上线或其余 AUX 页面已实现。

## 实现边界

- `Session.apiPaths → AppLayout → ResourceHost → Registry app/role → RoleManagement → ListPageShell/公共 VM → 角色 VM → frontend/src/target/api.ts → Hono → ManagementService → PostgreSQL`。原 `app/user` 继续走同一公共列表，Registry 本片只包含 user、role。
- 公共 `apps/api/src/enablement/service.ts` 参与外层事务，经类型化 read/write 存储接口完成读取、revision 检查、转换检查、CAS 和通用审计；用户和角色各自仅适配原表并提供专有规则与副作用。单一状态/revision 保持在 app_users/app_roles，审计复用 app_audit_events。没有新增表、SQL 基线、独立启停 HTTP 入口或第二个状态版本。
- 陈旧 revision 优先于同状态与专有规则拒绝；同状态不增加 revision。用户停用撤销会话；角色停用保留关联与会话，后续受保护请求重新计算权限。通用审计与副作用均在同一事务。
- 纯拼音转换移动到 `apps/api/src/platform/pinyin.ts`，原 APP 用户写入、本人改名、种子及受控回填消费同一函数；用户的检索列和回填职责保持。角色查询按需计算真实拼音，在完整集合匹配后按 code/id 分页。
- 角色管理和用户角色引用改用 enabled；角色动作仅 edit/enable/disable，类型仍为 NORMAL/SYSTEM/SUPERADMIN。角色创建拒绝服务端字段，保存/启停只接收字符串 revision，旧状态筛选和数字 revision 被拒绝。独立权限目录仍用自身 ENABLED/DISABLED 状态。
- 角色写入在事务内返回结果，不隐含要求 get 或目录 query 授权；页面按实际编辑依赖检查 get/save/permission-query。权限集合保持精确，不自动补授 query/get；停用关联必须明确移除。

## 已执行命令

| 命令                                                                                      | 退出码 | 结果                                            |
| ----------------------------------------------------------------------------------------- | ------ | ----------------------------------------------- |
| `pnpm --filter @zerp/api exec node --test tests/unit/app-role-contract.test.ts`（实现前） | 1      | 原生 query 和严格写入契约两个测试失败，确认红灯 |
| 同上（Hono 契约切换后）                                                                   | 0      | 2 项通过                                        |
| `pnpm --filter @zerp/api generate:artifacts`                                              | 0      | 直接生成 OpenAPI 与权限目录，不调用 target-db   |
| `pnpm --filter @zerp/api typecheck`                                                       | 0      | API、脚本及测试类型检查通过                     |
| `pnpm --filter @zerp/api test:unit`                                                       | 0      | 41 项通过                                       |
| `pnpm --filter @zerp/api test:artifacts`                                                  | 0      | 20 项通过                                       |
| `pnpm --filter @zerp/api-client typecheck`                                                | 0      | 类型客户端通过                                  |
| `pnpm --filter @zerp/model typecheck`                                                     | 0      | 共享模型通过                                    |
| `pnpm docs:check`                                                                         | 0      | 文档规则和检查器测试通过                        |
| `pnpm format:check`                                                                       | 0      | 根级文档、配置和脚本格式通过                    |
| `git diff --check`                                                                        | 0      | 无空白错误                                      |

前端最终候选已执行以下命令（工作目录 frontend），退出码均为 0：`pnpm test:unit`（14 文件 72 项，另有 Vuetify 1 文件 10 项）、`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm build:target`。根目录 `make check-common` 退出码 0。最终补充的 E2E 请求头与定位修正通过前端类型、lint、格式检查；浏览器仍未实跑。

## 独立审查

### Standards

后端与前端独立审查均无未解决发现。共享启停、原子写入、类型化 API、公共 Shell/VM、协议清理和仓库边界符合当前约束。

### Spec

后端与前端独立审查均无未解决实现发现。主会话复核修正 E2E 直接请求缺少模型版本头及标题定位歧义，并让审计失败回滚测试明确期待 PostgreSQL 长度错误，避免其他提前拒绝被误算为回滚覆盖。新增角色浏览器场景覆盖桌面及 390px CRUD，并使用仅 get 单项授权验证无 query 请求、停用后原会话请求拒绝及恢复后入口撤销。

审查不是运行验收证明：以下环境验证缺口保持开放。Standards 0 个未解决发现；Spec 0 个未解决实现发现。

## 未执行项与验收缺口

现有会话未配置 TARGET_DATABASE_URL、TARGET_TEST_DATABASE_URL、TARGET_WEB_BASE_URL 或 TARGET_API_BASE_URL；未发现运行中的 zerp-target 栈。运行中的 zerp-back 服务属于既有共享环境，没有被当作本次 target 验证环境使用。

- PostgreSQL 集成测试与桌面/390px 浏览器闭环尚未实跑。新增审计持久化失败用例通过领域服务验证用户/角色状态、revision、审计、会话和关联整体回滚；未执行不能算通过。最后管理员的拒绝逻辑保留，但未通过改动其他既有授权事实来制造该场景。新增测试代码不等于 B2-04–11、13、23、25 已获真实环境证明；事务回滚、权限即时收回、用户会话副作用和 UI 操作仍有运行验证缺口。
- 未执行 `make generate`、`make check`、`make test`、`make e2e` 或 target 对应聚合命令：它们会经过 target-db 删除数据库卷。本票明确禁止自动重建数据或新建隔离环境。
- 未执行 `generate:db`：本片未修改 SQL 基线或持久化结构，现有 Kysely 类型仍适用。
- 未执行 catalog 同步、生产环境变更、临时部署、备份、CI/保护规则修改；未推送、创建 PR、合并或关闭 Issue。

本会话未启动数据库、API/Web、隧道或浏览器辅助服务；既有共享服务保持原状。
