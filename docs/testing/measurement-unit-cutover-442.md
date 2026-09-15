# 计量单位一次性转换（#442）

业务规则见 [AUX](../domains/aux.md)、[BOB](../domains/bob.md) 和 [VOU](../domains/vou.md)。可执行入口为 `apps/api/scripts/cutover-measurement-units.ts`；持久化转换由 AUX 服务拥有。此文是发布操作说明，不是第二套接口契约。

## 转换前

1. 在隔离副本演练；确认源版本为取消符号前的数据库结构。转换拒绝已经转换的数据库。
2. 停止所有业务写入入口（API、WFL、导入及定时任务）。保留旧版本镜像，记录源和目标完整 Git SHA。
3. 对同一停写点制作 PostgreSQL 完整备份和附件目录完整归档；验证备份能在隔离实例恢复。即使附件为空也保留有效空归档。保存备份文件 SHA-256，禁止把备份、连接串或真实资料提交到仓库。
4. 通过受控环境提供 `TARGET_DATABASE_URL`、`TARGET_DATABASE_SCOPE`。在仓库根目录运行只读盘点：

   ```sh
   node apps/api/scripts/cutover-measurement-units.ts
   ```

5. 为盘点中的每个 stable unit ID 明确指定 `fixedFactor`：固定单位填写正数字符串；产品专属换算单位填写 `null`。不根据名称自动推测。审核后的 JSON 文件形如 `[{"id":"<26位单位ID>","fixedFactor":"1"}]`。
6. 携带该文件重新盘点并保存输出：

   ```sh
   node apps/api/scripts/cutover-measurement-units.ts --units units.json > baseline.json
   ```

所有 blocker 必须先处理。历史产品的换算系数若与拟设固定系数不一致，转换拒绝，不能舍入数量或偷偷覆盖系数；应重新确认该单位是否属于产品专属换算。历史快照缺失、来源结构不完整、仍引用旧单位字段的执行定义也必须处理。修改源数据或决策后须重新备份、重新盘点。

## 执行与验收

备份 manifest 使用以下结构，路径指向实际备份文件；两个 SHA 是文件内容的 SHA-256：

```json
{
  "sourceReleaseSha": "<源40位Git SHA>",
  "targetReleaseSha": "<目标40位Git SHA>",
  "database": { "path": "<数据库备份路径>", "sha256": "<64位摘要>" },
  "attachments": { "path": "<附件归档路径>", "sha256": "<64位摘要>" }
}
```

确认目标代码的 `ZERP_RELEASE_SHA` 与 manifest 相同，以启用的超级管理员 stable ID 执行：

```sh
node apps/api/scripts/cutover-measurement-units.ts --apply --units units.json --baseline baseline.json --backup backup.json --actor-id '<操作者ID>' --writers-frozen
```

入口核对备份摘要和目标 SHA；服务在单一事务内锁表，校验全库事实基线与操作者，替换当前单位及已采用快照中的旧字段，删除固定单位在产品上的冗余系数，刷新系统字段目录。读回所有表，除明确的单位字段投影外，逐值验证原始数据不变；数量、价格、金额、审批状态、revision、时间、稳定身份和历史名称均不重算。转换报告及转换前相关行保存在 `aux_measurement_unit_conversion_evidence`，仅供审计/恢复，运行时不读取旧结构。

完成后启动目标 API，核对健康、权限目录、单位列表、产品及历史单据详情；分别验证固定单位和产品专属单位的换算建议，以及新输入 `1.234` 被拒绝、`1.23` 成功。核对旧高精度数量、库存和金额结果未变，然后恢复业务写入。

## 失败与恢复

- 事务内任一步失败会回滚结构和数据；保持停写，重新盘点确认原基线，不直接重试变更后的源数据。
- 事务成功但发布验收失败：保持停写，恢复同一 manifest 的数据库和附件备份，启动 manifest 中的源版本并验证健康及业务读取后再恢复写入。禁止让旧代码连接已转换结构，也不以逆向猜测系数作为回滚。
- 集成测试 `unit-cutover.int.test.ts` 使用转换前 schema，覆盖冲突拒绝、基线漂移、事务末端失败回滚、产品历史精度及审批、VOU 行与配方数量/价格原值保留。真实环境发布仍须完成该环境的备份恢复演练；本任务不自动执行线上转换。
