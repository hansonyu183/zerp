# 五类档案归属切换（#438）

本入口只转换 DCL／BOB 所有权，不转换客户子单位或税务模型。规格见 [DCL](../domains/dcl.md)、[BOB](../domains/bob.md) 和 [ADR-0062](../adr/0062-dcl-maintenance-bob-formal-history.md)。当前数据库基线是 `apps/api/db/target-schema.sql`；迁移前独立测试基线来自 `f806548031768f8b84c48ca8dbec8c06bccbe789`，保存在 `apps/api/tests/fixtures/issue-438-before.sql`，仅用于验证与恢复证据。

## 切换与恢复

1. 按现有发布流程准备同一完整 SHA 的 API/Web，完成完整 `make target-e2e`。记录旧运行容器镜像 ID、API/Web SHA、数据库及附件卷。迁移程序不自动部署应用。
2. 停止旧 API 及所有业务写入者，保持数据库和附件卷冻结；使用 `pg_dump` 备份整个数据库、归档完整附件卷。恢复包必须配套旧 API/Web 镜像，业务数据和凭证不得提交仓库。
3. 在受控环境变量提供 `TARGET_DATABASE_URL` 和正确的 `TARGET_DATABASE_SCOPE`。执行 `pnpm --filter @zerp/api exec node scripts/cutover-archives.ts`，保存输出为基线文件。该命令只读，输出计数与摘要，不打印业务正文。
4. 准备备份清单：`sourceReleaseSha`、`targetReleaseSha` 为完整 SHA，`database` 和 `attachments` 分别包含备份文件 `path` 与 `sha256`。执行 `pnpm --filter @zerp/api exec node scripts/cutover-archives.ts --apply --writers-frozen --baseline <基线文件> --backup <清单文件>`。路径相对 API 工作目录；生产操作建议使用绝对路径。
5. 程序先验证备份摘要，再在同一事务锁定表、重验基线、迁移稳定身份与类型化内容归属、精确权限、审批域及 AUX 引用来源，保留对象启停、版本与附件键。比较所有受影响档案事实及角色精确授权后提交；任何失败使 DDL、数据和权限一起回滚，不允许继续启用新应用。成功后撤销旧 Session，用户重新登录。
6. 启动匹配目标 SHA 的 API/Web，验证 `/healthz`、`/readyz`、Session 导航、DCL 提交件、BOB 正式／历史读取及附件；记录实际容器镜像 ID、完整 SHA 和健康状态后开放写入。按根 AGENTS 规则只保留 API 当前及最近两个历史 SHA 标签。
7. 若提交后验证失败，停止目标应用，整库恢复原数据库备份并恢复配套附件卷，启动原 SHA 的 API/Web；回读旧正式资料、历史、附件与健康后再恢复写入。不得只回滚镜像或在目标数据上启动旧应用。

## 核对口径

转换保持 stable ID、编码、Approval Entry ID、版本号、状态、Submission revision、审批事件、类型化内容、子单位、附件元数据和物理键、幂等结果、精确业务引用及 enabled/object revision。BOB 的对象身份读取是 DCL 身份与 BOB 启停的只读关联，不存储 current payload。迁移前已有其他领域的历史 DCL 证据保持；身份或权限路径冲突阻断转换。

维护／审批路径一对一从 BOB 迁到 DCL；BOB 正式读取、versions、audit-history、启停保持。原客户附件读取能力保留，并等价转换提交件附件读取路径，各入口继续检查对应 get、versions 或 submission-get。save-subunits 单独迁移，不推导提交或审批权限。普通角色不新增启停、提交或审批能力。

独立迁移测试通过真实旧基线、后期故障回滚、角色授权和迁移后 Hono 正式／历史查询验证转换；最终验收记录见 [#438 验证](../testing/issue-438-archive-ownership.md)。
