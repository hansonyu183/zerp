# 经营主体与员工一次性迁入 AUX

本命令只用于 #394 将既有经营主体与员工从 DCL 版本资料切换为 AUX current data。它不表示已经获得生产迁移或发布授权，也不得在旧 API 仍接受写入时执行。

执行前使用匹配待发布 SHA 的代码和生成权限目录，停止旧 API 及会写入 DCL、VOU、角色或权限的进程，并按既有发布流程确认数据库备份及整库恢复方式。凭证只通过受控环境注入；`TARGET_DATABASE_SCOPE` 必须明确为 `isolated` 或 `production`，命令和日志不得输出连接串、角色明细或业务快照。

```sh
TARGET_DATABASE_URL=... TARGET_DATABASE_SCOPE=production \
  pnpm --filter @zerp/api migrate:aux-people
```

命令在一个 PostgreSQL transaction 中完成以下工作：

1. 扩展 `aux_objects` 的实体约束、放宽三个历史经营主体 Approval 引用列，并增加 `vou_reference_snapshots.aux_snapshot`；
2. 每个旧 subject 采用最高 `APPROVED` 内容；只有单独存在的开放 V1 保留其内容供 AUX 直接维护，正式内容与候选并存、非 V1 候选、缺少 typed snapshot 或已存在 AUX current 都返回 blocker；
3. 保留 stable ID、业务编码、启停事实和创建/更新审计，以 revision 1 写入 AUX，并把编号计数器至少推进到旧 DCL 已分配位置；
4. 按 VOU 行保存的精确 `approval_reference_id` 读取旧经营主体或员工 typed snapshot，写入 `aux_snapshot`；原 object ID、code、name、Approval Entry 和选择来源不改写，身份不一致或精确历史缺失时整笔拒绝；
5. 为保留的 DCL、VOU 与 ACC 历史引用登记 `aux_reference_facts`；ACC 覆盖期初 `EMPLOYEE` 维度、期初票据对手方、非期初会计分录 `EMPLOYEE` 维度，并按期初事实的既有来源键去重，使 AUX 物理删除仍受全部历史事实阻止；
6. 将旧 BOB/DCL query、get、submit-new 和 submit-change 授权转换为已确认的 AUX 精确动作。旧审批、版本、审计和删除权限不映射。

任一 blocker、权限等价检查或数据库错误都会回滚 schema、current data、历史快照、引用事实、审计、计数器和权限目录。先使用匹配的旧应用正常处理 blocker，再重新停止写入并重跑；不得直接删候选、改历史快照或绕过权限检查。普通 `sync:catalog` 检测到尚未转换的旧人员权限时会拒绝执行，避免先删除旧角色授权。

成功输出只包含迁移数量和权限目录报告。随后启动匹配 SHA 的唯一 API，核对健康状态、经营主体与员工列表/详情、代表性历史 VOU 详情、有限角色的实际动作和旧 DCL/BOB 路径不可达。回退必须恢复匹配的完整数据库备份和旧应用版本，不做局部反向转换，也不增加运行时旧表读取。
