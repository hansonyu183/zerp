# 普通原始附件归档结构升级

维护入口 `apps/api/scripts/upgrade-attachment-archive.ts` 对应 [#501](https://github.com/hansonyu183/zerp/issues/501)、[#502](https://github.com/hansonyu183/zerp/issues/502)、[DCL 附件规则](../domains/dcl.md#3-精确授权与附件)和 [VOU 附件规则](../domains/vou.md#5-附件)。目标运行时只使用当前附件契约；升级是一次性结构操作，不导入或修复原文件。

支持已完成服务真实相对方升级的完整149表来源布局，包括正常初始化、先前维护保留三个约束名称，以及经 PostgreSQL 18 `pg_dump/pg_restore` 证明的各自恢复布局。已扩大到0–20 MiB或仍为1–10 MiB的已核验布局，以及此前客户、产品和供应商共同原件布局，都执行到当前五类档案共同原件结构。全部列、约束及索引必须匹配已核验指纹；未知或混合结构拒绝；已经是当前布局时不重复 apply。较早147表或尚未完成真实服务相对方升级的149表，先完成[服务此前事实升级](service-carryover-upgrade.md)，封存其全库基线后继续本入口。

转换保留客户永久附件的文件身份、所有历史关联、元数据和存储键，将其持久化表改为五类档案共同使用；暂存表新增必需实体与主体绑定。来源客户暂存记录没有主体事实，存在任何行即拒绝，不能推定或补造绑定。应先通过匹配来源镜像的正常授权 cleanup 清理已过期暂存件；未过期原件保留、等待按正常流程处理后再冻结，不能用维护 SQL 删除。此前客户专属布局的产品、供应商、其他单位与销售合作方版本新增已知无附件的空集合；这描述此前目标能力，不认定任何 OIT 来源没有文件。此前容量约束必要时扩大至四种 MIME 与0–20 MiB。

逐表核验所有原事实。此前客户专属布局只允许明确的两个附件表改名及四类typed版本新增空附件集合；此前三类共同布局只允许其他单位、销售合作方两类typed版本新增空集合及暂存实体约束扩大。新增字段的表在 DDL 前使用 PostgreSQL JSONB 投影计算完整预期行，DDL 后与其精确比较；其余行逐字相同。约束名称转换至规范名称。恢复产生的 varchar 数组 CHECK 表达差异仍绑定已证明的完整布局指纹，不忽略约束、不接受任意相似结构。配对恢复分别核验完整布局、全部事实和精确原件字节。<!-- docs-check: legacy-exception=release-cutover ref=ADR-0050 -->

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

   CLI 先核验配对工件和版本；事务锁定所有 public 表，重新核对完整布局、事实基线及维护身份。DDL 后必须达到与该来源相配的当前布局，并逐表证明原事实及明确的空集合结构投影完全相等；失败整体回滚。不改文件内容或路径，不自动授予权限。

5. 启动同 SHA 候选 API/Web，独立回读已有档案、单据、文件内容和授权，检查新的原样/空文件正常上传及读取。未知执行结果先核对布局、原基线和存储键，不盲目重复 apply。需要恢复时保持写入冻结，确认没有后续业务写入，再恢复已演练的数据库、附件和源镜像，并回读原安装身份和完整基线。关闭临时恢复库、目录及测试进程。

配对备份摘要校验、升级事务保全、真实恢复和正常账号下载分别验证；通过其中一项不能代替其他项。共享生产不在独占试迁授权范围，全范围 OIT 迁移验收另行完成。

销售合作方和其他单位原件（[#504](https://github.com/hansonyu183/zerp/issues/504)）沿同一维护流程承接：现有三类附件完整布局只新增两类typed版本`attachments=[]`及扩大暂存实体集合，原有非空Customer/Product/Supplier原件元数据、永久存储键、所有表行和权限事实不变。两种较早Customer布局仍按受支持的一次性转换进入当前五类结构；未匹配完整布局、基线变化、未冻结或配对恢复工件不符均拒绝。
