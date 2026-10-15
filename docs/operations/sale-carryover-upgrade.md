# 销售此前事实保留数据结构升级

本入口承接已实现的[销售此前事实](../domains/vou.md)结构，不导入来源、不补写历史数量、金额或日期、不授予权限。适用已提交7353ef2e及同形状的三张业务表；既有采购和服务此前事实允许非空。来源与当前三表的完整字段、物理类型、空值、默认/生成属性、约束及索引摘要分别是 `60178b9ff5a5bdb7fe0c4fe4747d6fe1de988df420147dd8284fbd01145946bd`、`ce3a91c56385c82e37b6f0909a48cf30592c47f39f7ff70e2d811d670ea6a413`。

转换只扩展 `vou_prior_facts` 的原类型及组件形状，并增加可空的 `vou_source_line_snapshots.prior_stock_lines`、`vou_signoff_line_snapshots.prior_lost_quantity_micros` 和 `prior_amount_minor`。已有行新字段为NULL，没有零值回填或历史效果重放。其它字段、索引、约束与全部public原行必须保持，安装身份必须存在且唯一；未知或混合布局拒绝。

1. 先核对独占安装身份、源镜像和完整SHA。构建最终同SHA API/Web，并在实际发布节点确认该精确SHA的 **Full runtime acceptance** 成功；草稿CI不是放行。当前真实试迁升级暂停，本文不启动维护。
2. 冻结此安装的全部写入方，取得数据库及附件配对备份，验证完整字节摘要和在独占临时目标的实际恢复。沿用[维护输入格式](purchase-carryover-upgrade.md)：`sourceReleaseSha`、`targetReleaseSha`、`database`和`attachments`分别含真实路径及SHA256；加载受控凭证，不打印。对全部public行、安装、账号/权限、原件逐字节、库存与分录保存基线。
3. 候选环境在只读REPEATABLE READ事务封存基线：

   ```sh
   node apps/api/scripts/upgrade-sale-carryover.ts > .scratch/sale-carryover-baseline.json
   ```

   只有 `SOURCE` 可执行；`CURRENT` 不重复apply，`UNSUPPORTED` 保持写入关闭。<!-- docs-check: legacy-exception=release-cutover ref=ADR-0050 -->

4. 真实启用superadmin维护用户明确冻结声明：

   ```sh
   node apps/api/scripts/upgrade-sale-carryover.ts --apply \
     --baseline .scratch/sale-carryover-baseline.json \
     --backup .scratch/sale-carryover-backup-manifest.json \
     --actor-id "$SALE_UPGRADE_ACTOR_ID" --writers-frozen
   ```

   `ZERP_RELEASE_SHA`必须与目标manifest相等，数据库边界由受控`TARGET_DATABASE_URL`及`TARGET_DATABASE_SCOPE`核对。CLI校验配对备份真实字节；领域维护事务锁全部public表、重验完整基线及维护身份，再DDL并逐行比较。任何异常回滚全部本次转换。

5. 旧九项服务权限布局还须运行已验证的 `upgrade-service-contexts.ts`，使用它自己的最新基线及同一恢复边界；先后均保持API和其它写者关闭。该入口只扩展CHECK，不授予Customer或此前权限。业务采用权限另外经正常APP受审。
6. 两阶段及最终结构都成功后才能启动最终同SHA API/Web，公开回读安装、原采购/服务、数量金额、角色、库存分录和附件；与升级前完整事实比较。结果未知时先只读判定当前布局和原事实，不能盲目重复提交。
7. 提交后验证失败，保持写入关闭并先确认无后续业务；整体恢复配对数据库/附件及7353源镜像，独立回读原基线。不能只回滚镜像、只恢复数据库或在中间结构运行旧服务。回收本次临时恢复库/文件/进程。

此升级不改变现有ACC账簿或开始期，不承认旧截止数据已变成7d0，不代表OIT全范围迁移或人工验收已完成。
