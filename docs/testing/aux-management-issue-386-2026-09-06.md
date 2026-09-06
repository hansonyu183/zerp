# 2026-09-06 #386 AUX 共用管理与两页验证

基线为 `8ba1d97d`，分支为 `codex/issue-386-aux-management`。前序 #385 的真实 PostgreSQL 与桌面/390px 浏览器续验已记录在[角色验证](role-management-issue-385-2026-09-06.md)。本票覆盖全部十二个 AUX 共用管理协议，并只登记人员类别、岗位两页。

## 实现边界

- `Session.apiPaths → AppLayout → ResourceHost → Registry → 人员类别/岗位页面 → 公共 ListPageShell/列表 VM → 模块 VM → frontend/src/target/api.ts → Hono → AuxService → PostgreSQL`。
- AUX 管理采用严格 typed 字段、原生列表摘要和字符串 revision；历史嵌入引用与候选保留自己的 objectId 语义。name 仍是 typed data 中的唯一可写事实，py 从当前名称计算。
- APP 用户、角色与 AUX 共用完整启停组件，组件参与外层事务；AUX 域写锁、专有规则、CAS、通用审计原子提交。aux_objects 是 AUX 状态与对象 revision 的唯一持久化事实，未新增 SQL 表或拼音存储。
- 人员类别与岗位共享名称/说明展示表单，其余 AUX 页面仍为尚未实现；未迁移 DCL、审批与业务版本语义保持有效。

## 环境与执行边界

按修订后的 #384/#386 及本次明确授权，创建本任务专用 `zerp-issue386` Compose 项目，数据库/API/Web 仅绑定回环 55440/18084/18085。启动前确认项目无容器、三个端口无监听。凭证由仓库忽略目录中的受控环境文件注入，未打印或提交。保留原有 zerp-back 共享环境。

直接运行生成、聚焦测试和检查入口，不运行默认 project 的 target-db 或 make e2e 等重建聚合命令。本任务不做备份、恢复演练、CI/工作流/保护规则或生产操作。

## 验证记录

| 命令                                                                                                                                                                                                                                                                     | 退出码 | 结果                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------- |
| 专用 Compose `config --quiet`                                                                                                                                                                                                                                            | 0      | 配置合法                                                                         |
| 专用 Compose `up -d --wait target-db`                                                                                                                                                                                                                                    | 0      | 本任务 PostgreSQL healthy                                                        |
| `pnpm --filter @zerp/api sync:catalog`                                                                                                                                                                                                                                   | 0      | 专用库权限目录同步                                                               |
| 专用 Compose `build target-api target-web`                                                                                                                                                                                                                               | 0      | 基线镜像构建；最终候选另行重建                                                   |
| `pnpm docs:check`                                                                                                                                                                                                                                                        | 0      | 初始领域/用例/ADR 修改检查通过                                                   |
| `pnpm --filter @zerp/api generate:artifacts`                                                                                                                                                                                                                             | 0      | 直接从 Hono/Zod 生成契约与权限目录                                               |
| `pnpm --filter @zerp/api test:unit`                                                                                                                                                                                                                                      | 0      | 45 项通过                                                                        |
| `pnpm --filter @zerp/api test:artifacts`                                                                                                                                                                                                                                 | 0      | 20 项通过                                                                        |
| `pnpm --filter @zerp/api-client typecheck`                                                                                                                                                                                                                               | 0      | 类型客户端通过                                                                   |
| `pnpm --filter @zerp/model typecheck`                                                                                                                                                                                                                                    | 0      | 共享模型通过                                                                     |
| `pnpm --filter @zerp/frontend typecheck`、`lint`、`format:check`、`build:target`                                                                                                                                                                                         | 0      | 前端候选通过                                                                     |
| `pnpm --filter @zerp/frontend test:unit`                                                                                                                                                                                                                                 | 0      | 77 项普通测试、10 项 Vuetify 测试通过                                            |
| 专用 Compose 最终候选 `build target-api target-web`、`up -d --wait target-api target-web`                                                                                                                                                                                | 0      | 数据库/API/Web healthy                                                           |
| `pnpm --filter @zerp/api exec node --test --test-concurrency=1 tests/integration/app-user-management.int.test.ts tests/integration/app-session-user-query.int.test.ts tests/integration/independent-capabilities.int.test.ts tests/integration/acc-wfl-http.int.test.ts` | 1      | 21 项中 20 项通过；发现损坏 payment 持久化数据被默认值掩盖，修复后复验该失败场景 |
| `node --test` 聚焦 `acc-wfl-http.int.test.ts`、`aux-management.int.test.ts`、`independent-capabilities.int.test.ts`（修复后）                                                                                                                                            | 0      | 6 项通过，损坏 payment 持久化数据仍拒绝                                          |
| `node --test tests/integration/aux-management.int.test.ts`（最终补测）                                                                                                                                                                                                   | 0      | 3 组通过：搜索分页/改名、并发与大整数/审计回滚、实体规则与引用                   |
| `pnpm --filter @zerp/api exec node --test --test-name-pattern='all issue 364 aggregates' tests/integration/archive-lifecycle.int.test.ts`                                                                                                                                | 0      | 完整客户业务 fixture：停用后新采用拒绝、已批准历史快照不变，1 项通过             |
| `pnpm --filter @zerp/api e2e -- aux.spec.ts user.spec.ts`                                                                                                                                                                                                                | 1      | 用户/角色 5 项通过；AUX 两页桌面完成，移动端测试展开无关导航分组超时             |
| `pnpm --filter @zerp/api e2e -- aux.spec.ts`（定位修正后）                                                                                                                                                                                                               | 0      | 两页桌面及 390px 全部操作通过，2 项/36.8 秒                                      |
| 同上（截图禁用过渡动画后）                                                                                                                                                                                                                                               | 0      | 2 项/36.2 秒；稳定业务截图核验通过                                               |

以上 `node --test` 命令经 `pnpm --filter @zerp/api exec` 执行，真实库连接来自本任务受控环境。复用首轮未受修改影响的通过证据与失败场景复验，所有本票聚焦场景无未解决失败、无跳过；没有把未运行测试计为通过。

## 行为证据与审查

- Hono 契约先出现 3 项红灯，再通过全部十二实体的严格原生协议测试。旧 wrapper、身份别名、数字 revision、创建时服务端字段、保存时启停字段被拒绝；详情与写入区分服务端字典快照字段。
- PostgreSQL 以完整集合检索第 21 条、真实拼音、改名、稳定排序与 total 验证分页；以 `Promise.allSettled` 同时请求相同 revision，确认只有一个成功且只有一份审计。陈旧与同状态冲突不写入；保存、启停、删除都覆盖超过 Number 安全整数的字符串 revision。
- 审计错误明确匹配 PostgreSQL `22001`，确认状态/revision 回滚；APP 用户/角色及 AUX 三类真实消费者共同证明公共启停的读取、CAS、审计和事务参与。字典项停用后可重新启用，派生快照字段不作为客户端输入校验或回写。
- 固定结算约束、默认值与严格持久化读取、引用 blocker 和停用后候选排除均有真实库证据。完整 DCL 客户流程验证停用收款方式后新客户不能采用，而已批准客户的 payment/settlement 快照继续由 ArchiveService 读出原采用值，读取不改写 AUX 状态、revision 或加价。
- 两页各通过桌面和 390px，创建超过一页数据后按名称、编码及拼音搜索第 21 条，再改名、保存与启停。用户与角色 5 项浏览器回归覆盖 Session、自助操作、搜索分页、角色分配和权限撤销。主会话核对两页桌面列表与移动编辑器稳定截图，未见溢出或操作遮挡；表格保留横向滑动提示。
- 公开 VM 回归确认取消、乱序/卸载、未知结果不重放，以及创建成功后刷新失败仍显示成功并保留已创建 ID。复用 ResourceHost 按 Session generation 卸载旧实例的验证；公共 Shell/列表 VM 未增加 AUX 业务特判。

独立 Standards 与 Spec 审查分开完成。发现的字典项重新启用、创建后 ID 保留、持久化字段被默认值掩盖和 API 格式问题均已修复并复验。权限常量和 Session generation 的初始疑虑经真实调用链核对撤回，没有为此新增重复控制层。最终 Standards 0 个未解决发现，Spec 0 个未解决发现。

## 未执行范围与交付

未运行 `make generate/check/test/e2e` 等默认 project 重建聚合入口；按本票执行边界使用直接生成与聚焦验证命令，未操作 CI/工作流/保护规则。未修改 SQL，故未重建基线或运行 `generate:db`；Kysely 类型无变化。未扩展无关全仓旧页面、WFL parity 或生产验证。未做备份、恢复演练、推送、PR、合并、上线或关闭 Issue。

## 最终检查与资源回收

- 最终 API 类型检查、前端类型/lint/格式检查、`make check-common` 均退出 0。生成物由直接 artifacts 命令生成，暂存后再次生成确认无未暂存漂移；`git diff --check` 通过。
- 收尾前专用数据库/API/Web 均 healthy。专用 Compose `down --volumes --rmi local` 退出 0；回读项目容器、卷、网络及镜像均为空，55440/18084/18085 均无监听。受控测试环境文件已删除。
- 原有 `zerp-back-web-1`、`zerp-back-api-1`、`zerp-back-db-1` 仍运行且 healthy。没有需用户手动停止的本任务服务。
- 最终补充的完整客户历史快照测试经独立只读复审，确认新提交的拒绝不是无效 fixture 的提前失败，快照断言和审计清理有效，无剩余发现。
