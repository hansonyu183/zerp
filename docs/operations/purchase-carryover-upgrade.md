# 采购此前事实结构保留数据升级

对应 [VOU采购此前事实承接](../domains/vou.md) 和 [#475](https://github.com/hansonyu183/zerp/issues/475) / [PR #482](https://github.com/hansonyu183/zerp/pull/482)。维护入口是 `apps/api/scripts/upgrade-purchase-carryover.ts`，业务服务只使用当前结构。

默认转换新增当前采购承接所需的两张表`vou_prior_facts`、`vou_return_allocation_counters`及来源行/退货行的三个空字段。当前结构由唯一schema决定，含显式非空的`vou_prior_facts.source_closed`；默认转换接受此前能力建立前的b445结构，`--source-closure`转换接受已建立此前能力但缺少关闭字段的de92554/a714结构。两条转换分别冻结其来源和当前结构的字段、完整物理类型、空值/默认/生成属性、约束与索引，未知或混合结构拒绝。基线绑定安装身份及全部public表原行，数字保留PostgreSQL JSON文本，不经过JavaScript数值。已有已批准采购退货需要单独证明其分配顺序；本入口明确拒绝，不按时间或ID猜序。默认转换只适用于已证明该数量为零的维护目标。关闭字段转换仅接受`vou_prior_facts`为空的来源；已有此前记录必须另从权威封存来源确认逐条关闭状态，当前入口拒绝执行，不给旧记录默认false。

1. 只读确认独占维护目标的Compose项目、安装身份、源完整SHA及运行镜像，完成候选测试和同SHA镜像构建。源码、凭证和业务正文不得输出或提交。生产执行仍要求相应维护窗口授权；试迁授权只适用于明确的隔离目标。
2. 停止该目标的API及其他写入方。保存并校验可读的 `pg_dump -Fc` 与附件归档，在独立恢复目标演练恢复，记录行数、原数量及金额、来源hash、审批、库存、分录及其他表指纹。不可用备份不得执行；不得以重建试迁库替代保留数据升级。
3. 备份manifest包含完整 `sourceReleaseSha`、`targetReleaseSha`，以及 `database`、`attachments` 各自的 `path` 与SHA256 `sha256`。路径指向已验证工件。候选执行环境设置受控 `TARGET_DATABASE_URL`、正确的 `TARGET_DATABASE_SCOPE` 和与manifest相同的 `ZERP_RELEASE_SHA`，不打印环境值。
4. 在候选代码下只读检查并保存基线：

   ```sh
   node apps/api/scripts/upgrade-purchase-carryover.ts > .scratch/purchase-carryover-baseline.json
   ```

   若来源已安装此前能力，只补充关闭事实，使用对应检查入口：

   ```sh
   node apps/api/scripts/upgrade-purchase-carryover.ts --source-closure > .scratch/source-closure-baseline.json
   ```

   `LEGACY` 才可执行；`CURRENT` 表示本转换已不适用，不重复apply；`UNSUPPORTED` 保持入口关闭并核查布局。未知布局的数量为null，不解释为零。<!-- docs-check: legacy-exception=release-cutover ref=ADR-0050 -->

5. 使用当前启用且拥有启用 `superadmin` 角色的真实维护用户。显式声明已冻结写入后执行：

   ```sh
   node apps/api/scripts/upgrade-purchase-carryover.ts --apply \
     --baseline .scratch/purchase-carryover-baseline.json \
     --backup .scratch/purchase-carryover-backup-manifest.json \
     --actor-id "$PURCHASE_UPGRADE_ACTOR_ID" --writers-frozen
   ```

   已安装此前能力的关闭字段转换使用同一备份/版本门禁，执行：

   ```sh
   node apps/api/scripts/upgrade-purchase-carryover.ts --source-closure --apply \
     --baseline .scratch/source-closure-baseline.json \
     --backup .scratch/source-closure-backup-manifest.json \
     --actor-id "$PURCHASE_UPGRADE_ACTOR_ID" --writers-frozen
   ```

   CLI校验备份字节及目标release。领域维护函数在同一事务锁定全部public表，重验完整基线和维护身份，从当前唯一schema提取新增表定义，并增加三个可空字段。逐表/逐行比较投影后的全部原事实，要求新表为空且最终结构精确匹配；关闭字段转换在全表锁下复验此前事实为空，新增非空boolean列且不设置默认值；完整原行必须逐表相等，当前布局精确匹配。异常回滚全部DDL，不重演审批、履约、库存或记账。

6. 成功后启动同SHA API/Web，回读安装身份、原订单、数量/金额、来源摘要与完整原业务事实，并验证新的正常采购此前事实/实际金额/后续数量采用。其余表数据、关联及账簿余额必须与维护基线一致。保留非敏感摘要与备份；本转换不代表OIT未结义务、期初或全范围迁移已完成。
7. 失败时保持写入关闭。未提交操作由事务回滚；已提交后需要恢复时，先确认没有新业务写入，再从已演练的数据库和附件工件恢复，运行源SHA API/Web并独立回读原基线。不得在新结构上运行旧服务，不保留运行时兼容列。关闭本次临时恢复数据库、容器及辅助进程。

## 独立此前收货结构升级（#492）

已经保存此前采购事实的安装使用显式 `--standalone-receipts` 检查/执行，不能重放此前事实为空的关闭字段转换。来源必须精确匹配具有关闭字段、仅 AA/AD/AB/AF 类型且没有原行引用表的布局。此转换扩展 AH 持久化形状并从当前 schema 创建 `vou_prior_receipt_line_origins`；不转换或重演任何既有业务事实。此前表允许非空，批准、原金额、微秒截止、分配顺序及全部其他 public 行必须逐字节相等，新表必须为空，最终布局精确匹配。

沿用上述独占目标、停止全部写入方、数据库/附件真实备份及独立恢复、完整 release SHA、维护用户、全表锁和 CAS 基线要求；与 `--source-closure` 互斥。检查与执行为：

```sh
node apps/api/scripts/upgrade-purchase-carryover.ts --standalone-receipts > .scratch/standalone-receipts-baseline.json
node apps/api/scripts/upgrade-purchase-carryover.ts --standalone-receipts --apply \
  --baseline .scratch/standalone-receipts-baseline.json \
  --backup .scratch/purchase-carryover-backup-manifest.json \
  --actor-id "$PURCHASE_UPGRADE_ACTOR_ID" --writers-frozen
```

`CURRENT`、未知布局、并发数据漂移、无权维护、备份字节或 release 不符拒绝；全部 DDL 在同一事务中完成，后验失败回滚。升级后必须在相同 SHA 的 API/Web 上验证既有档案与单据、库存与会计基线、正常独立此前收货/退货的零重复效果及截止后退货的实际出库、记账和开票容量；升级本身不是全范围迁移完成证据。

服务约定、履约明细及 Supplier 授权形状的后续保留数据转换见[服务结构升级](service-carryover-upgrade.md)。
