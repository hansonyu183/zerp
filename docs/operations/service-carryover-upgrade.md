# 服务此前事实与真实相对方结构升级

维护入口 `apps/api/scripts/upgrade-service-carryover.ts` 对应 [VOU 服务规则](../domains/vou.md#314-服务合同与履约验收)、[#496](https://github.com/hansonyu183/zerp/issues/496) 与 [#498](https://github.com/hansonyu183/zerp/issues/498)。业务服务只使用当前 schema。

支持两套明确来源：147 表采购收货授权布局，或已完成 #496 的 149 表服务布局；每套区分正常初始化与受支持维护产生的约束名称，完整字段、约束和索引必须匹配已核验指纹，未知或混合布局拒绝。

147 表转换建立服务明细及原引用表、明确采购组成，并仅为旧服务授权承接普通 OtherUnit/SalesPartner 合同或普通合同履约类型。149 表转换只扩展服务授权字段的类型形状，全部业务事实及授予数组保留；不会自动授予 Supplier 或此前来源权限。已有服务明细允许非空，完整原行仍须相等。

1. 核对独占目标、安装身份、源镜像与完整 SHA；候选最终 SHA 必须通过 CI 的 **Full runtime acceptance**，草稿快速检查不能替代。构建同 SHA 的 API/Web。
2. 停止全部目标写入方，校验数据库与附件真实备份，并在独立临时目标演练恢复。备份 manifest 采用既有 [维护输入](purchase-carryover-upgrade.md) 格式，包含源/目标完整 SHA、数据库与附件路径及 SHA256。凭证通过受控环境加载，不打印。
3. 在候选环境只读检查并封存基线：

   ```sh
   node apps/api/scripts/upgrade-service-carryover.ts > .scratch/service-carryover-baseline.json
   ```

   仅 `SOURCE` 可执行；`CURRENT` 不重复 apply；`UNSUPPORTED` 保持写入关闭并核查。<!-- docs-check: legacy-exception=release-cutover ref=ADR-0050 -->

4. 使用当前启用且拥有启用 superadmin 角色的真实维护用户，明确声明写者冻结：

   ```sh
   node apps/api/scripts/upgrade-service-carryover.ts --apply \
     --baseline .scratch/service-carryover-baseline.json \
     --backup .scratch/service-carryover-backup-manifest.json \
     --actor-id "$SERVICE_UPGRADE_ACTOR_ID" --writers-frozen
   ```

   CLI 核验工件字节及版本；维护函数在事务内锁定所有 public 表，重验基线和操作者，完成 DDL 后对比原行并要求对应当前结构。147 表来源的新服务表必须为空；149 表来源的原服务行和权限数组必须完整保留。账号密码、成员、审批、库存、资金及会计事实不变。

5. 启动候选同 SHA API/Web，独立回读档案、原单、权限、账号与账簿。未知执行结果先检查当前布局及原行，不能盲目重跑。失败保持写入关闭；需要恢复时先确认没有后续业务写入，再恢复已演练的数据库/附件及源镜像，并回读原基线。关闭临时恢复库及辅助资源。

升级没有导入 OIT 服务或期初，不构成全范围迁移完成证明。共享生产不在试迁授权范围。
