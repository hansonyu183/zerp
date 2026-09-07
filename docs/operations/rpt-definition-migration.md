# RPT 当前定义一次性转换

在受控环境设置 `TARGET_DATABASE_URL` 和对应 `TARGET_DATABASE_SCOPE` 后运行 `pnpm --filter @zerp/api migrate:rpt`。命令调用 RPT Migration Service，在一个事务中锁定来源、检查未决候选、保留稳定身份与审计、建立当前配置并转换权限。无需重建数据库；不要调用会隐式清库的 make 聚合命令。

最高已批准内容成为当前定义；仅开放 V1 保留内容为 INVALID，需授权维护人员通过 definition/save 修正并验证。其他未决候选返回含 subjectId 与原因的 blocker，须先通过原系统正常流程解决，再运行转换。失败整体回滚，不删除候选、不自动批准。已转换数据库再次执行明确拒绝。

旧定义与有效性分别保留为 `rpt_definition_history`、`rpt_definition_validity_history`，旧 Approval/运行审计保持精确引用；新运行审计记录 definition_revision，不回查历史定义执行。旧 query/get 映射为 definition/get，旧提交/审批权限退休，save 需显式授予；报表精确 query/export 及其角色关联保留。

转换后分项运行 generate:artifacts、generate:db、typecheck、相关单元和数据库测试及 validate:rpt。定义维护通过 [RPT 可执行 API](../../apps/api/src/rpt/contract.ts)，使用者界面不开放 SQL 设计器。此命令不部署 API 或 Web，也不停止共享服务。
