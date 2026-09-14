# #438 DCL／BOB 归属验证

迁移前基线：`f806548031768f8b84c48ca8dbec8c06bccbe789`。范围为五类档案维护归属与正式对象历史，客户子单位和税务模型保持。操作与恢复步骤见 [切换手册](../operations/archive-ownership-cutover.md)。

## 已验证的公共边界

- Hono 路由红绿验证：旧 BOB submit-new 不可达，DCL 五类入口可达。
- 真实 PostgreSQL 迁移：独立旧 schema 上保留正式版、开放提交件、启停与 object revision；精确角色授权迁移后由 Hono 查询验证。陈旧基线拒绝，后期权限不匹配导致整笔 DDL／数据回滚。
- 三类身份档案 HTTP：待批旧版可读、批准采用、反批准回落与独立启停；只有 versions 权限可读历史，不能读取 DCL 提交件或审批，错误主体／Entry 组合拒绝。
- 公共组件：DCL 提交、取消、未知结果锁定及迟到响应；BOB 对象历史、差异、附件与启停，历史页不呈现维护或审批动作。

## 备份与恢复演练

2026-09-14 使用隔离 PostgreSQL 旧 schema 和合成客户／附件数据完成实际 `pg_dump -Fc`、附件 tar 备份、CLI 转换、BOB 附件读取、另一空库 `pg_restore --exit-on-error` 和附件解包。


- 转换代码 SHA：`d8bd8418a6859f2555a75d554290984030f84a4c`。
- 旧库／恢复库基线一致：`a1b5ce4da564982c4a2d10992d9b7da0b6066e002287ddea5de1f72301f03a36`。
- 数据库备份 SHA-256：`de68ba7e52dbdef11648ea5b1694e5f1c2e043c294d6987d343d0019d4136054`。
- 附件归档 SHA-256：`94e6f0f99a66718627d54218af0053dcefb12985970725d208fea0b52b6bf202`。
- 附件内容 SHA-256：`d97409e0d040a28238e2c73133d6f41014cb8f90e6eeebcdf874e3c2f6428ffc`；目标 BOB 读取及恢复后字节一致。
- 事实对照：1 个客户 stable ID／编码、1 个已批准 Entry／类型化快照、1 个附件原键和摘要全部保持；enabled=false、object revision=7 保持。完整迁移回归另外覆盖开放提交件、原有 DCL 历史、精确授权、AUX 引用转换和失败原子回滚。
- 合成备份、报告和执行脚本保留在本地忽略目录 `.scratch/438/`，不提交附件或数据库备份；演练数据库已显式删除。

## 最终门禁

`make check`、`make test` 已通过。完整 `make target-e2e` 正在验证，结果在结束后记录。

本记录不表示已经切换生产；生产 SHA、镜像 ID 和健康状态必须在实际发布后记录。
