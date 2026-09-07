# 供应商、其他单位与销售合作方一次性迁入 BOB

本命令只用于 #396 将既有 Supplier、Other Unit 与 Sales Partner 从 DCL 版本资料切换为 BOB。它不表示已经获得生产迁移或发布授权，也不得在旧 API 仍接受写入时执行。

执行前使用匹配待发布 SHA 的代码和生成权限目录，停止旧 API 及会写入 DCL、BOB、VOU、角色或权限的进程。凭证只通过受控环境注入；TARGET_DATABASE_SCOPE 必须明确为 isolated 或 production，命令和日志不得输出连接串、角色明细或业务快照。

完整受控顺序固定如下。三个一次性迁移都成功后，才允许普通权限目录同步：

    TARGET_DATABASE_URL=... TARGET_DATABASE_SCOPE=production pnpm --filter @zerp/api migrate:aux-people
    TARGET_DATABASE_URL=... TARGET_DATABASE_SCOPE=production pnpm --filter @zerp/api migrate:aux-assets
    TARGET_DATABASE_URL=... TARGET_DATABASE_SCOPE=production pnpm --filter @zerp/api migrate:bob-archives
    TARGET_DATABASE_URL=... TARGET_DATABASE_SCOPE=production pnpm --filter @zerp/api sync:catalog

前两步先把 AUX current 及其历史引用事实迁入，同时保留三类 BOB 档案的全部旧权限 ID 与角色授权，直到第三步精确转换；第三步保留三类 BOB stable ID、Approval Entry、typed snapshot、审计与精确授权，并将旧 dcl: 历史来源改为 bob:。<!-- docs-check: legacy-exception=historical-read ref=ADR-0055 --> 普通 `sync:catalog` 在发现尚未迁移的三类 DCL 档案授权时会拒绝执行，避免先删除原授权。

任一 blocker、权限等价检查或数据库错误都会回滚该命令所在事务。先使用迁移前的匹配应用正常处理 blocker，再重新停止写入并从失败步骤重跑；不得直接删候选、改历史快照或绕过权限检查。成功后启动匹配 SHA 的唯一 API，核对三类 BOB 正式资料、提交/版本历史、有限角色的实际动作与 DCL 路径不可达。
