# 客户与全部子单位一次性迁入 BOB

在前置人员、资产、三类档案及产品转换完成后，用受控环境执行 `pnpm --filter @zerp/api migrate:bob-customer`；该命令同时完成客户权限目录转换。连接参数仅由环境传入，不输出凭证；不使用会重建数据库的聚合命令，也不包含生产发布。

CustomerMigrationService 在同一事务校验源与目标、迁移稳定根及全部子单位表、附件与暂存、转换 Approval domain、精确引用登记及角色授权。客户、子单位和历史 Approval Entry ID 不变；旧整体启停保存为只读历史证据，当前整体启停按所选正式版本初始化。子单位 enabled 留在版本内容中。销售和收款采用的精确引用及快照不重写。

<!-- docs-check: legacy-exception=historical-read ref=ADR-0055 --> 旧 query/get 只转换为提交读取，原 BOB 正式读取保留。旧附件、子单位维护和生命周期权限精确转换；普通角色不会自动获得 enable/disable。已有动态报表权限的标识、启停状态及角色授权保持不变。源基线异常、重复或引用冲突使整个事务回滚，修正明确事实后重新执行。已完成时拒绝重复转换，不再创建旧表或兼容读取。

验收检查迁移计数、稳定 ID、完整版本内容、子单位编码、附件引用、角色权限和销售收款历史连续性；再分别运行生成物、客户 HTTP、页面及下游回归。依据 [BOB 客户](../domains/bob.md#34-客户与客户子单位) 与 [ADR-0055](../adr/0055-bob-archives-use-shared-approval-and-version.md)。
