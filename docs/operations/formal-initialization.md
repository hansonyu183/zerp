# 正式初始化与数据库 seed

适用于单一 ZERP 实例的正式初始化；下述清空步骤仅适用于已明确授权清空的实例。账号规则见 [APP 正式初始化](../domains/app.md#正式初始化)，内账初始资料见 [ACC 会计账簿](../domains/acc.md#2-会计账簿)。本流程不导入历史交易，也不代表鑫泉整仓迁移完成。

## 配置和日常启动

从根 `.env.production.example` 分别配置两个正式管理员的账号编码、显示名称和凭证文件。凭证文件仅包含一行符合 APP 策略的初始密码，以受控文件权限保存；不得进入 Git、命令行参数、日志或 Issue。`compose.production.yaml` 将它作为 secret 挂载给 `admin-initialize`。

启动顺序为健康数据库、`catalog-sync`、`admin-initialize`、`database-seed`、API、Web。管理员初始化通过 `TargetBootstrapService.initializeAdministrators` 原子创建两个正式账号及 `superadmin` 关联；没有用户和角色才允许创建。两个账号都存在时不改变身份、密码、角色、启停状态、revision 或会话。重复执行会报告 `unchanged`。任一指定账号不存在但库内已有账号或角色时失败，须核实配置，不能自动提升其他账号。

`database-seed` 执行 `pnpm --filter @zerp/api seed`，只需要受控 `TARGET_DATABASE_URL`、显式 `TARGET_DATABASE_SCOPE` 和两个 `APP_ADMIN_*_USERNAME`，不读取密码文件。它通过 `AccService.initializeInternalBook` 在同一事务创建内账、185 个科目及两位管理员的查询/操作范围；首次执行要求两人仍为启用的正式管理员。账簿开始月份固定为 `2026-01`，本位币为 `CNY`，首本账簿自动成为业务控制账簿。

同一账簿锁防止并发创建；中途失败整体回滚。固定初始化身份存在时返回 `unchanged`，不会覆盖之后修改的账簿、科目或范围，也不会补回主动删除的科目；没有该身份但已有其他账簿时失败，必须先核实既有基线。日常启动不会导入人员、部门、期初金额、记账映射或批准记录。新内账接收业务记账前，须按 VOU 正常流程提交并由另一位有权用户批准期初，再维护所需记账映射。

内账完成后，seed 通过 RPT 服务创建客户往来余额、客户销售订单明细、科目流水、库存数量余额四个报表，再通过 APP 服务创建 12 个部门角色和精确授权。两个阶段分别使用事务锁和 `app_seed_runs` 完成记录；阶段内失败回滚，重试继续未完成阶段，已完成阶段不覆盖人工修改。报表按稳定身份授权；角色不分配给现有用户，不新增业务用户或员工关联，也不增加账簿范围。

正式初始化保留已确认的受控密码，两个账号不要求首次改密；普通用户经 APP 创建时仍必须首次改密。日常改密和授权仅用 APP 管理能力；修改部署凭证文件不重置已存在账号。保留有效的初始化凭证文件，以供同一配置正常启动及经授权的全新数据库初始化。

## 经授权的清空步骤

1. 只读核验 Docker context、Compose 项目、实际容器、数据库名与数据库用户、数据库挂载、API/Web 完整 SHA、公网入口及当前账号。明确正式管理员身份，排除其他数据库、实例和共享资源。
2. 完成代码检查和独占可丢弃数据库演练；准备并验证同一候选版本的 API/Web 镜像及正式初始化配置。Compose 配置检查只输出校验结果，不输出展开后的环境。
3. 停止目标实例 API 和 Web，并确认没有其他业务写入进程；停止窗口内保持目录同步和初始化作业不并发运行。回读目标数据库连接和身份，核实只含当前基线的 `public` 应用 schema，发现额外 schema 或未知写入方时停止执行。
4. #446 已明确不备份这批旧 ZERP 数据。在目标数据库一个事务内删除并重建 `public` schema，应用当前版本 `apps/api/db/target-schema.sql`；失败回滚并保持业务入口关闭。不要删除数据库容器、数据库卷或任何附件卷。
5. 使用正式配置依次执行目录同步、管理员初始化、数据库 seed 并启动同一版本 API/Web。初始化失败时保持业务入口关闭，解决原因后重复执行；不得运行内测种子或伪造审批记录。
6. 独立回读全部表的行数。允许非空的初始化表为 `app_installation`（单一随机目标身份）、`app_permissions`、`app_users`、`app_roles`、`app_user_roles`、`app_system_parameters`、`app_role_code_counters`、`archive_code_counters`、`rpt_code_counter`、`acc_mapping_vou_entities`，以及 `acc_books`（1 本内账）、`acc_subjects`（185 个科目）和 `acc_book_access`（2 位管理员）；登录验收后还允许本次 `app_sessions` 和 `app_audit_events`。另允许部门 seed 生成的 `app_role_permissions`、`app_seed_runs`、`rpt_definitions`、`rpt_definition_audits`；角色共 13 个（超级管理员及 12 个业务角色），部门报表 4 个。其他业务表必须为空；管理员只有明确配置的两人，`superadmin` 无逐项权限关联。
7. 验证两个账号的公网登录、按权限读取及旧测试账号登录失败；持有旧会话时验证旧会话失效。记录 Session Context 的 `targetId`，重复执行启动链并重启 API 时核对身份不变；重建数据库后不得沿用旧目标身份或旧批次映射。回读密码、授权、账号数量、初始账簿基线和健康状态。浏览器填写秘密后不得输出 DOM、截图或请求体；自动验证只报告断言结果。
8. 记录目标、实际运行完整 SHA、非敏感验收结果和未完成项。按仓库规则清理该 API 镜像仓库的旧标签；回收本次演练数据库、进程和容器，保留既有生产与共享资源。数据库外附件本任务不删除。

## 自动验收

`apps/api/tests/integration/formal-initialization.int.test.ts` 从显式 `TARGET_TEST_DATABASE_URL` 的独占测试实例创建自己拥有的随机 `_test` 数据库，调用真实初始化 CLI 与 APP 公共服务，验证并发首次初始化、不新增强制改密、普通改密后的旧会话失效、重复启动、权限移交保留、非空基线拒绝新增管理员、重建后的旧会话失效及空业务表。测试结束删除该随机数据库和临时凭证目录。

`apps/api/tests/integration/database-seed.int.test.ts` 在独占随机测试库调用真实 seed CLI，验证并发首次初始化、185 个科目及层级/辅助属性、失败原子回滚、已有账簿基线拒绝，以及人工维护名称、删除科目和调整授权后重复执行不覆盖。测试结束删除该随机数据库。

完整验证使用 `make e2e`，另用生产 Compose 拓扑和一次性测试配置验证 `catalog-sync → admin-initialize → database-seed → api → web` 的健康与重复启动。不得让测试连接公网库或生产库。
