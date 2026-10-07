# 采购此前事实结构保留数据升级

对应 [VOU采购此前事实承接](../domains/vou.md) 和 [#475](https://github.com/hansonyu183/zerp/issues/475) / [PR #482](https://github.com/hansonyu183/zerp/pull/482)。维护入口是 `apps/api/scripts/upgrade-purchase-carryover.ts`，业务服务只使用当前结构。

该入口只新增当前采购承接所需的两张表`vou_prior_facts`、`vou_return_allocation_counters`及来源行/退货行的三个空字段。冻结b445旧结构和de92554当前结构的字段、完整物理类型、空值/默认/生成属性、约束与索引，未知或混合结构拒绝。基线绑定安装身份及全部public表原行，数字保留PostgreSQL JSON文本，不经过JavaScript数值。已有已批准采购退货需要单独证明其分配顺序；本入口明确拒绝，不按时间或ID猜序。本次只适用于已证明该数量为零的维护目标。

1. 只读确认独占维护目标的Compose项目、安装身份、源完整SHA及运行镜像，完成候选测试和同SHA镜像构建。源码、凭证和业务正文不得输出或提交。生产执行仍要求相应维护窗口授权；试迁授权只适用于明确的隔离目标。
2. 停止该目标的API及其他写入方。保存并校验可读的 `pg_dump -Fc` 与附件归档，在独立恢复目标演练恢复，记录行数、原数量及金额、来源hash、审批、库存、分录及其他表指纹。不可用备份不得执行；不得以重建试迁库替代保留数据升级。
3. 备份manifest包含完整 `sourceReleaseSha`、`targetReleaseSha`，以及 `database`、`attachments` 各自的 `path` 与SHA256 `sha256`。路径指向已验证工件。候选执行环境设置受控 `TARGET_DATABASE_URL`、正确的 `TARGET_DATABASE_SCOPE` 和与manifest相同的 `ZERP_RELEASE_SHA`，不打印环境值。
4. 在候选代码下只读检查并保存基线：

   ```sh
   node apps/api/scripts/upgrade-purchase-carryover.ts > .scratch/purchase-carryover-baseline.json
   ```

   `LEGACY` 才可执行；`CURRENT` 表示本转换已不适用，不重复apply；`UNSUPPORTED` 保持入口关闭并核查布局。未知布局的数量为null，不解释为零。<!-- docs-check: legacy-exception=release-cutover ref=ADR-0050 -->

5. 使用当前启用且拥有启用 `superadmin` 角色的真实维护用户。显式声明已冻结写入后执行：

   ```sh
   node apps/api/scripts/upgrade-purchase-carryover.ts --apply \
     --baseline .scratch/purchase-carryover-baseline.json \
     --backup .scratch/purchase-carryover-backup-manifest.json \
     --actor-id "$PURCHASE_UPGRADE_ACTOR_ID" --writers-frozen
   ```

   CLI校验备份字节及目标release。领域维护函数在同一事务锁定全部public表，重验完整基线和维护身份，从当前唯一schema提取新增表定义，并增加三个可空字段。逐表/逐行比较投影后的全部原事实，要求新表为空且最终结构精确匹配；异常回滚全部DDL，不重演审批、履约、库存或记账。

6. 成功后启动同SHA API/Web，回读安装身份、原订单、数量/金额、来源摘要与完整原业务事实，并验证新的正常采购此前事实/实际金额/后续数量采用。其余表数据、关联及账簿余额必须与维护基线一致。保留非敏感摘要与备份；本转换不代表OIT未结义务、期初或全范围迁移已完成。
7. 失败时保持写入关闭。未提交操作由事务回滚；已提交后需要恢复时，先确认没有新业务写入，再从已演练的数据库和附件工件恢复，运行源SHA API/Web并独立回读原基线。不得在新结构上运行旧服务，不保留运行时兼容列。关闭本次临时恢复数据库、容器及辅助进程。
