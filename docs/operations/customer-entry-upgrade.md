# 客户首次建档模型升级

权威规则见 [BOB](../domains/bob.md)、[AUX](../domains/aux.md) 与 [VOU](../domains/vou.md)。升级取消混合客户类型，增加独立物流对账分组、默认特批、默认出货仓库和月结日；月度计算来源保留订单最终特批，不再提供客户类型代码。

`apps/api/scripts/upgrade-customer-entry.ts` 只适用于已确认客户版本、月度计算稿和居间计算脚本均为空的现有单层客户数据库。它保留账号、员工、其他资料和附件。存在相关数据时拒绝升级，必须先形成逐项转换决定，不能从旧类型猜测特批。OIT 可继续写入；冻结范围只包括升级中的 ZERP 写入者。

1. 完成同一候选的完整 `make e2e`，准备同一完整 SHA 的 API/Web，记录旧运行镜像与卷。
2. 停止 ZERP API 和其他 ZERP 写入者，备份整个数据库和附件卷。保存私有清单：`sourceReleaseSha`、`targetReleaseSha`、`database: {path, sha256}`、`attachments: {path, sha256}`；不提交正文或凭证。
3. 在受控环境提供 `TARGET_DATABASE_URL`、`TARGET_DATABASE_SCOPE`，运行 `node apps/api/scripts/upgrade-customer-entry.ts` 并保存只读基线。命令只输出计数和摘要。
4. 从目标发布工件运行以下命令；`ZERP_RELEASE_SHA` 必须等于清单中的目标 SHA：

```sh
node apps/api/scripts/upgrade-customer-entry.ts --apply --writers-frozen \
  --baseline .scratch/customer-entry-baseline.json \
  --backup .scratch/customer-entry-backup.json
```

5. 工具验证备份摘要，在同一事务锁内重验基线与空数据条件，修改类型化列，并为旧普通字典类型一次性补齐 `purpose=GENERAL`。失败全部回滚；不部署应用、不导入客户。
6. 启动对应 SHA 的 API/Web，核实健康、发布身份、原账号和员工、公开客户提交/批准/回读，再恢复 ZERP 入口。客户导入通过正常公开 API 和不同批准人执行。
7. 提交后验证失败时，停止目标写入者，恢复同一份数据库和附件备份以及配套旧 API/Web；核实原基线后恢复入口。不得仅回滚镜像。

仍采用多子单位结构的旧库使用 [整体转换入口](../testing/issue-439-customer-cutover.md)。其 `--customer-entry-defaults` 文件按旧子单位 stable ID 明确给出 `{defaultSpecialApproval: boolean}`，预览和应用必须使用同一文件。旧字典用途补为 GENERAL 并保存原始证据；存量月度来源、计算稿或脚本没有经批准的转换时，预览阻断，不能误报可应用。
