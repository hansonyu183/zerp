# 流程定义迁回 WFL

使用当前受控环境执行 `pnpm --filter @zerp/api migrate:wfl`；`TARGET_DATABASE_URL` 指向待转换数据库，并按现有环境设置 `TARGET_DATABASE_SCOPE`。不要运行会重建数据库的 `make generate`、`make e2e` 或 `target-db`。

迁移先检查目标尚不存在、历史 Entry 均有定义快照，再锁定源身份、审批、运行和授权表。在同一事务创建 WFL 稳定身份、保留 ID/编码/创建审计，迁移 Entry 与审批事件归属、实例/开关外键，并按精确路径转换权限。脚本、编译图、实例、节点、动作结果、试算及运行审计保持原记录。无旧定义读取或第二份定义权威。

旧 DCL query/get 只转为 WFL submission-query/submission-get，旧 WFL 当前查询权限保持；其他维护动作一对一转换。普通目录同步在转换前拒绝丢弃旧权限。

历史不完整、目标已存在或授权校验失败时停止，事务全部回滚；通过正常业务流程或修正部署顺序处理后再执行。不得自动批准候选或删除历史。成功后无需重复执行迁移；生成 Hono 工件与数据库类型使用分项 `generate:artifacts`、`generate:db`，不隐式清库。本操作不含生产部署。
