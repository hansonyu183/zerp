# 普通原始附件归档结构升级

维护入口 `apps/api/scripts/upgrade-attachment-archive.ts` 对应 [#501](https://github.com/hansonyu183/zerp/issues/501) 和 [VOU 附件规则](../domains/vou.md#5-附件)。目标运行时只使用当前附件契约；升级是一次性结构操作，不导入或修复原文件。

支持已完成服务真实相对方升级的两套完整149表来源布局：正常初始化布局，及先前维护保留三个约束名称的布局。全部列、约束及索引必须匹配已核验指纹；未知或混合结构拒绝。只扩大四个附件长度 CHECK 和 VOU 暂存 MIME CHECK，全部业务行、安装身份、用户密码、授权、批准记录、此前事实和存储键逐表保全。已经是当前布局时不重复 apply。较早147表或尚未完成真实服务相对方升级的149表，使用[服务此前事实升级](service-carryover-upgrade.md)直接到当前结构。

每套还明确支持经真实 PostgreSQL 18 `pg_dump/pg_restore` 核验的恢复布局。恢复会将33项 CHECK 和1项部分索引中的 varchar 数组整体 text 转换改为逐元素 text 转换；列、约束身份、有效性、全部原行和存储键不变。恢复形状及升级后的对应形状各有完整指纹，另核验当前结构再次恢复后的完整指纹；不忽略约束、不做通用表达式归一化，不接受任意相似结构。恢复核对分别比较完整来源/恢复布局和全部事实，不能要求这两种已核验表达形式的原始结构摘要相同。

1. 核对独占目标、安装身份、源和候选镜像的完整 SHA；候选最终 SHA 的 **Full runtime acceptance** 必须成功，草稿快速检查不足以交付。构建同 SHA 的 API/Web。
2. 冻结全部目标写入方，取得数据库和完整附件持久卷的配对备份，逐字节核验摘要，并在独立临时安装演练恢复；保持源镜像可恢复。备份 manifest 使用既有[维护输入格式](purchase-carryover-upgrade.md)，包含源/目标完整 SHA、数据库和附件各自路径及 SHA256。凭证仅由受控环境加载，不打印。
3. 在候选环境只读检查并封存全库事实基线：

   ```sh
   node apps/api/scripts/upgrade-attachment-archive.ts > .scratch/attachment-archive-baseline.json
   ```

   仅 `SOURCE` 可执行；`CURRENT` 不重复执行；`UNSUPPORTED` 保持写入关闭并核查。<!-- docs-check: legacy-exception=release-cutover ref=ADR-0050 -->

4. 使用现有启用且拥有启用 superadmin 角色的真实维护账号，明确声明写者冻结：

   ```sh
   node apps/api/scripts/upgrade-attachment-archive.ts --apply \
     --baseline .scratch/attachment-archive-baseline.json \
     --backup .scratch/attachment-archive-backup-manifest.json \
     --actor-id "$ARCHIVE_UPGRADE_ACTOR_ID" --writers-frozen
   ```

   CLI 先核验配对工件和版本；事务锁定所有 public 表，重新核对完整布局、事实基线及维护身份。DDL 后必须达到与该来源相配的当前布局，并逐表证明全部原行完全相等；失败整体回滚。不改文件内容或路径，不自动授予权限。

5. 启动同 SHA 候选 API/Web，独立回读已有档案、单据、文件内容和授权，检查新的原样/空文件正常上传及读取。未知执行结果先核对布局、原基线和存储键，不盲目重复 apply。需要恢复时保持写入冻结，确认没有后续业务写入，再恢复已演练的数据库、附件和源镜像，并回读原安装身份和完整基线。关闭临时恢复库、目录及测试进程。

配对备份摘要校验、升级事务保全、真实恢复和正常账号下载分别验证；通过其中一项不能代替其他项。共享生产不在独占试迁授权范围，全范围 OIT 迁移验收另行完成。
