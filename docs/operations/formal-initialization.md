# 正式初始化与空业务基线

适用于已明确授权清空的单一 ZERP 实例。账号规则见 [APP 正式初始化](../domains/app.md#正式初始化)。本流程不导入业务资料，也不代表鑫泉整仓迁移完成。

## 配置和日常启动

从根 `.env.production.example` 配置正式管理员账号编码、显示名称和凭证文件。凭证文件仅包含一行符合 APP 策略的初始密码，以受控文件权限保存；不得进入 Git、命令行参数、日志或 Issue。`compose.production.yaml` 将它作为 secret 挂载给 `admin-initialize`。

启动顺序为健康数据库、`catalog-sync`、`admin-initialize`、API、Web。初始化通过 `TargetBootstrapService.initializeAdministrator` 创建唯一首个账号及 `superadmin` 关联；没有用户和角色才允许创建。账号存在时不改变身份、密码、角色、启停状态、revision 或会话。重复执行会报告 `unchanged`。指定账号不存在但库内已有账号或角色时失败，须核实配置，不能自动提升其他账号。

首次登录后按页面要求修改初始密码，再以新密码登录。日常改密和授权仅用 APP 管理能力；修改部署凭证文件不重置已存在账号。保留有效的初始化凭证文件，以供同一配置正常启动及经授权的全新数据库初始化。

## 经授权的清空步骤

1. 只读核验 Docker context、Compose 项目、实际容器、数据库名与数据库用户、数据库挂载、API/Web 完整 SHA、公网入口及当前账号。明确正式管理员身份，排除其他数据库、实例和共享资源。
2. 完成代码检查和独占可丢弃数据库演练；准备并验证同一候选版本的 API/Web 镜像及正式初始化配置。Compose 配置检查只输出校验结果，不输出展开后的环境。
3. 停止目标实例 API 和 Web，并确认没有其他业务写入进程；停止窗口内保持目录同步和初始化作业不并发运行。回读目标数据库连接和身份，核实只含当前基线的 `public` 应用 schema，发现额外 schema 或未知写入方时停止执行。
4. #446 已明确不备份这批旧 ZERP 数据。在目标数据库一个事务内删除并重建 `public` schema，应用当前版本 `apps/api/db/target-schema.sql`；失败回滚并保持业务入口关闭。不要删除数据库容器、数据库卷或任何附件卷。
5. 使用正式配置依次执行目录同步、管理员初始化并启动同一版本 API/Web。初始化失败时保持业务入口关闭，解决原因后重复执行；不得运行内测种子或伪造审批记录。
6. 独立回读全部表的行数。允许非空的初始化表只有 `app_permissions`、`app_users`、`app_roles`、`app_user_roles`、`app_system_parameters`、`app_role_code_counters`、`archive_code_counters`、`rpt_code_counter`、`acc_mapping_vou_entities`；登录验收后还允许本次 `app_sessions` 和 `app_audit_events`。其他业务表必须为空；管理员只有明确配置的一人，`superadmin` 无逐项权限关联。
7. 验证公网登录、首次改密、按权限读取及旧测试账号登录失败；持有旧会话时验证旧会话失效。重复执行启动链并重启 API，回读新密码、授权、账号数量、业务空基线和健康状态。浏览器填写秘密后不得输出 DOM、截图或请求体；自动验证只报告断言结果。
8. 记录目标、实际运行完整 SHA、非敏感验收结果和未完成项。按仓库规则清理该 API 镜像仓库的旧标签；回收本次演练数据库、进程和容器，保留既有生产与共享资源。数据库外附件本任务不删除。

## 自动验收

`apps/api/tests/integration/formal-initialization.int.test.ts` 从显式 `TARGET_TEST_DATABASE_URL` 的独占测试实例创建自己拥有的随机 `_test` 数据库，调用真实初始化 CLI 与 APP 公共服务，验证并发首次初始化、强制改密、重复启动、权限移交保留、非空基线拒绝新增管理员、重建后的旧会话失效及空业务表。测试结束删除该随机数据库和临时凭证目录。

完整验证使用 `make e2e`，另用生产 Compose 拓扑和一次性测试配置验证 `catalog-sync → admin-initialize → api → web` 的健康与重复启动。不得让测试连接公网库或生产库。
