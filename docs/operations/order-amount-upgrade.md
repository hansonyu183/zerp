# 订单金额结构保留数据升级

对应 [VOU 订单计价](../domains/vou.md) 和 [#480](https://github.com/hansonyu183/zerp/issues/480)。维护入口是 `apps/api/scripts/upgrade-order-amounts.ts`，业务服务只使用当前结构。

该入口只转换 `vou_product_line_snapshots` 和 `vou_intermediary_source_line_snapshots`。支持的70列旧布局与72列当前布局冻结于 `52e495d0`：字段名、完整物理类型、空值、默认值和生成属性均核验；计价约束必须符合当前形状。基线还绑定约束、索引、安装身份与每条原事实，数值以PostgreSQL JSON文本核对，不经过JavaScript数字。

1. 只读确认独占维护目标的Compose项目、安装身份、源完整SHA及运行镜像，完成候选测试和同SHA镜像构建。源码、凭证和业务正文不得输出或提交。生产执行仍要求相应维护窗口授权；试迁授权只适用于明确的隔离目标。
2. 停止该目标的API及其他写入方。保存并校验可读的 `pg_dump -Fc` 与附件归档，在独立恢复目标演练恢复，记录行数、原价格、来源hash、审批、库存、分录及其他表指纹。不可用备份不得执行；不得以重建试迁库替代保留数据升级。
3. 备份manifest包含完整 `sourceReleaseSha`、`targetReleaseSha`，以及 `database`、`attachments` 各自的 `path` 与SHA256 `sha256`。路径指向已验证工件。候选执行环境设置受控 `TARGET_DATABASE_URL`、正确的 `TARGET_DATABASE_SCOPE` 和与manifest相同的 `ZERP_RELEASE_SHA`，不打印环境值。
4. 在候选代码下只读检查并保存基线：

   ```sh
   node apps/api/scripts/upgrade-order-amounts.ts > .scratch/order-amount-baseline.json
   ```

   `LEGACY` 才可执行；`CURRENT` 表示本转换已不适用，不重复apply；`UNSUPPORTED` 保持入口关闭并核查布局。未知布局的数量为null，不解释为零。<!-- docs-check: legacy-exception=release-cutover ref=ADR-0050 -->

5. 使用当前启用且拥有启用 `superadmin` 角色的真实维护用户。显式声明已冻结写入后执行：

   ```sh
   node apps/api/scripts/upgrade-order-amounts.ts --apply \
     --baseline .scratch/order-amount-baseline.json \
     --backup .scratch/order-amount-backup-manifest.json \
     --actor-id "$AMOUNT_UPGRADE_ACTOR_ID" --writers-frozen
   ```

   CLI校验备份字节及目标release。领域维护函数在同一事务锁定两表、重验基线和维护身份，拒绝报价转换溢出。商品原分单价保留、两个新约定字段为NULL；居间原分单价乘10000并仅保留 `unit_price_micros`。转换后逐行核对原事实；异常回滚DDL及数据，不重演审批、履约、库存或记账。

6. 成功后启动同SHA API/Web，回读安装身份、原订单、报价、来源hash与完整原业务事实，并验证新的正常约定金额/资料采用。其余表数据、关联及账簿余额必须与维护基线一致。保留非敏感摘要与备份；本转换不代表OIT未结义务、期初或全范围迁移已完成。
7. 失败时保持写入关闭。未提交操作由事务回滚；已提交后需要恢复时，先确认没有新业务写入，再从已演练的数据库和附件工件恢复，运行源SHA API/Web并独立回读原基线。不得在新结构上运行旧服务，不保留运行时兼容列。关闭本次临时恢复数据库、容器及辅助进程。
