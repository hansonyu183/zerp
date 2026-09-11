# 产品一次性迁入 BOB

本命令用于 #397，前置条件为 #396 三类 BOB 档案转换完成。命令位于 `apps/api/scripts/migrate-bob-product.ts`，领域规则见 [BOB](../domains/bob.md#33-产品版本与独立启停) 和 [ADR-0055](../adr/0055-bob-archives-use-shared-approval-and-version.md)。本文件不授予生产部署或共享服务停机权限。

在已授权的环境停止旧版本写入后，从受控环境注入 `TARGET_DATABASE_URL` 与匹配的 `TARGET_DATABASE_SCOPE`，运行 `pnpm --filter @zerp/api migrate:bob-product`，成功后继续核对源基线涉及的客户、RPT、WFL 与会计期初等迁移；全部旧权限按目标版本转换后才运行 `pnpm --filter @zerp/api sync:catalog`。不得执行会隐式清库的 Make 聚合命令。

同一事务完成基线校验、条码占用检查、产品主体与版本表归属变更、Approval/Event 领域变更和精确权限映射。stable ID、编码、原 Approval Entry、全部版本内容、配方和交易引用保持；当前 enabled 从最高正式版本初始化，只有开放 V1 时从该版本初始化。旧 enabled 存入只读审计证据。<!-- docs-check: legacy-exception=historical-read ref=ADR-0055 --> 单位换算、基准数量、库存和交易快照不重算。

旧产品 query/get 权限一对一变为 submission-query/submission-get，其余旧审批与版本能力映射到同名 BOB 动作。已有 BOB 正式读取保留；不从旧提交权限授予 enable/disable。前置 AUX 和三档案迁移保留尚未转换的产品授权，普通目录同步拒绝提前删除它们。

基线不符、历史不完整、活动条码冲突或授权等价验证失败时，整笔事务回滚并给出 blocker。通过匹配源版本的正常业务流程解决后重试，不直接删除历史或改写引用。成功后使用匹配目标代码核对正式资料、提交件、历史、有限角色权限、交易采用和旧 DCL 产品入口不可达；源版本不可继续写入。
