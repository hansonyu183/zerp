# 2026-09-06 #385 公共启停与角色管理验证记录

范围为父规格 #384 的第一片：公共启停先接入用户，再接入角色；角色原生协议、角色页及用户角色直接消费者同步切换。基线为 `58bee225c1d2607e2cee00a7c8bf3c5ce8569f0d`，工作分支为 `codex/issue-385-role-management`。主实现提交为 `293dd38d`。本记录同时保存首轮静态验证和 Issue 修订后的真实环境续验，不代表合并、上线或其余 AUX 页面已实现。

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

首轮实现候选已执行以下命令（工作目录 frontend），退出码均为 0：`pnpm test:unit`（14 文件 72 项，另有 Vuetify 1 文件 10 项）、`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm build:target`。根目录 `make check-common` 退出码 0。最终补充的 E2E 请求头与定位修正通过前端类型、lint、格式检查；当时浏览器尚未实跑，续验结果如下。

## 独立审查

### Standards

后端与前端独立审查均无未解决发现。共享启停、原子写入、类型化 API、公共 Shell/VM、协议清理和仓库边界符合当前约束。

### Spec

后端与前端独立审查均无未解决实现发现。主会话复核修正 E2E 直接请求缺少模型版本头及标题定位歧义，并让审计失败回滚测试明确期待 PostgreSQL 长度错误，避免其他提前拒绝被误算为回滚覆盖。新增角色浏览器场景覆盖桌面及 390px CRUD，并使用仅 get 单项授权验证无 query 请求、停用后原会话请求拒绝及恢复后入口撤销。

首轮审查不代替运行验收；环境验证结果见下方续验记录。Standards 0 个未解决发现；Spec 0 个未解决实现发现。

## 首轮未执行项与后续授权

首次实现时，Issue 明确禁止创建隔离库和临时部署；现有会话没有 target 连接参数，因此只提交了实现、自动化用例和静态证据，真实 PostgreSQL/浏览器没有被误记为通过。未操作原有 zerp-back 共享环境、备份或 CI。

随后用户修改 #384/#385 并要求继续。修订后的规格允许必要的开发/测试环境准备、独立 Compose 与任务专用可丢弃资源初始化，仍禁止备份、恢复演练、CI/工作流/保护规则操作与共享数据重建。本轮按新边界完成以下续验。

## 真实环境续验

任务专用 Compose project 为 `zerp-issue385`，复用仓库 `compose.target.yaml`。数据库/API/Web 分别只绑定回环地址的 55440/18084/18085 端口；数据库为新建的 `zerp_target_test`，独立于既有共享服务。凭证仅通过忽略目录中的受控环境文件注入，未提交。初始化前确认该 project、端口与资源不属于其他任务；未运行默认 project 的破坏性聚合入口。

Docker 初次构建因容器解析 registry.npmjs.org 返回 EAI_AGAIN 而失败（退出码 1）；使用宿主当前 DNS 解析结果生成本任务临时 build extra_hosts 覆盖后，API/Web 镜像构建通过（退出码 0），未修改仓库网络、CI 或共享环境配置。

| 命令                                                                                                                                | 退出码 | 结果                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------- |
| `docker compose -p zerp-issue385 -f compose.target.yaml config --quiet`                                                             | 0      | 专用 Compose 配置有效                                 |
| 同项目 `up -d --wait target-db`                                                                                                     | 0      | 专用 PostgreSQL 健康                                  |
| `pnpm --filter @zerp/api sync:catalog`                                                                                              | 0      | 向专用库同步当前权限目录                              |
| `pnpm --filter @zerp/api generate:artifacts` 与 `generate:db`                                                                       | 0      | 133 表类型生成；生成物与提交一致                      |
| `git diff --exit-code -- apps/api/src/generated apps/api/src/db/generated.ts`                                                       | 0      | 无生成漂移                                            |
| `node --test --test-concurrency=1` 聚焦 app-session-user-query、app-user-management、user-pinyin-backfill、independent-capabilities | 1      | 19 项中 18 项通过，1 项仍断言旧 role reference status |
| `node --test --test-name-pattern='publishes assignable roles'`（修正 enabled 断言后）                                               | 0      | 原失败场景通过                                        |
| `node --test --test-name-pattern='final authorization administrator'`                                                               | 0      | 新增最后管理员场景通过，无跳过                        |
| 同项目带临时网络覆盖 `build target-api target-web`，随后 `up -d --wait target-api target-web`                                       | 0      | 专用 API/Web 健康                                     |

以上 Node 测试均通过 `pnpm --filter @zerp/api exec` 调用实际测试文件。复用未受修改影响的首轮通过证据，加上失败场景复验与新增用例，共覆盖 20 个真实 PostgreSQL 场景，无未解决失败。

续验确认用户停用与会话撤销原子提交、启用不复活；角色停用保持会话与关联但即时撤回权限；大整数 revision、同状态/陈旧请求、并发赢家唯一、停用权限显式移除、拼音分页与改名均符合规格。审计写入失败通过超出既有 request_id 长度约束产生真实 PostgreSQL 22001 错误，验证状态、revision、审计、关联及会话副作用整体回滚。最后管理员测试只调整本测试创建的角色和用户，并确认被拒操作前后的管理员资格不变；没有修改既有外部授权事实。

## 浏览器续验与收尾

| 命令                                                                                    | 退出码 | 结果                                              |
| --------------------------------------------------------------------------------------- | ------ | ------------------------------------------------- |
| `pnpm --filter @zerp/api e2e -- user.spec.ts`                                           | 1      | 5 项中前 4 项通过；单项权限场景暴露测试定位问题   |
| `pnpm --filter @zerp/api e2e -- user.spec.ts --grep 'role management\|a role with one'` | 0      | 最终两个角色场景均通过，32.2 秒                   |
| `pnpm --filter @zerp/frontend typecheck`、`lint`、`format:check`                        | 0      | 最终测试修改通过静态检查                          |
| 专用 Compose `ps`                                                                       | 0      | 清理前数据库/API/Web 全部 healthy                 |
| 专用 Compose `down --volumes --rmi local`                                               | 0      | 仅删除本任务容器、网络、附件卷与临时 API/Web 镜像 |

浏览器续验修复三处测试问题：权限目录使用虚拟列表，需滚动后定位；用户编辑器的已选角色 chip 会拦截点击，需等待可用后通过命名 combobox 的键盘操作展开；首次强制改密会撤销 Session，需重新登录后验证授权。中间定位复验失败均已解决，未因此修改业务实现。最终角色场景通过，复用未受改动影响的前三个用户场景通过证据，共覆盖 5 个浏览器场景。

真实浏览器确认：桌面和 390px 角色搜索、新建、编辑、启停；非 query 单项权限角色创建及用户分配；重新登录/恢复 Session 后展示入口而不发 query；停用角色后原会话下一次 get 返回 forbidden；恢复后入口撤销且直达页面显示无权访问。用户页自助流程、固定分页、亮暗主题与移动端回归通过。主会话复核用户桌面暗色、角色 390px 列表及编辑器截图，未见页面溢出或操作遮挡；移动表格保留横向滑动提示。

续验测试补充经独立 Standards/Spec 审查，无未解决发现。清理同时移除本任务构建失败留下的退出容器；回读确认本任务 Compose 容器、卷、网络和 55440/18084/18085 监听均已消失。原有共享 zerp-back 服务保留。未推送、创建 PR、合并、上线或关闭 Issue；未进行备份或 CI 操作。
