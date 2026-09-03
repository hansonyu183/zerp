# 客户变更用例

## 页面范围

- 路由：`/dcl/customer`
- 领域规则：[DCL 客户申报](../../domains/dcl.md#361-客户与客户子单位申报)、[BOB 客户边界](../../domains/bob.md#2-领域职责与边界)

本页是 Customer 及其全部客户子单位唯一维护入口。不存在 Party 页面、独立客户子单位页面、子单位审批任务或子单位版本历史。

## 创建与分区保存

1. 新建默认选择“大陆企业”，录入 Customer 根资料及至少一个启用客户子单位；创建同时要求 Customer create 与“维护客户子单位”权限。
2. Customer 顶部状态区只维护 Customer `enabled`。子单位列表紧凑显示编码、名称、客户类型、启停状态和操作，不显示联系人、联系电话或默认标记。
3. 新增和编辑子单位使用独立弹窗，维护稳定 `subunitId`、名称、联系人、业务地址、客户类型、结算、收款、运输、定价、信用额度、业务归属、内部提醒、订单默认值、业务附件与 `enabled`；联系人没有启停字段。
4. Customer 根资料通过 `save` 保存，完整子单位集合通过 `save-subunits` 保存；两个命令共享 candidate 与 revision，并拒绝另一边界的字段。任何保存失败都重新读取权威 candidate，不自动重放旧 revision。
5. 恰有一个启用子单位时业务入口可以隐式采用；两个及以上时必须明确选择，不显示或保存默认标记。

## 生命周期与删除

1. 页面编排 Customer 的本地 Draft、`query|get|submit|delete|versions|audit-history` 与 `reject|approve|unreject|unapprove`，并只展示服务端 `availableApprovalActions` 的审批动作。
2. 本地 Draft 显示“编辑草稿”；已批准且无开放 Submission 显示“发起变更”；存在开放 Submission 时可查看、删除或克隆为本地 Draft；不可编辑状态只显示“查看”。
3. Customer candidate 未批准时 BOB 和交易继续使用上一正式完整版本；批准后 Customer 与全部子单位一次切换。
4. 草稿删除、正式子单位移除和历史读取直接采用 [DCL 客户申报规则](../../domains/dcl.md#361-客户与客户子单位申报)；页面只展示服务端结果和 blocker。

## 验收场景

1. 创建、分区保存和一次批准原子覆盖 Customer 及全部子单位；失败不留下部分子单位或附件。
2. 客户法定识别号只在 Customer 类型内唯一；跨 Supplier 等类型不比较或合并。草稿可为空；提交和批准重新校验必填、身份格式和唯一性。
3. 真实权限验证根维护者、子单位维护者、只读用户和审批人只能执行各自完整闭环；列表和工作台只有一个 Customer 工作项。
4. 两级启停、单子单位隐式选择、多子单位明确选择、历史引用和反批准 blocker 采用领域规则，页面不得自动迁移子单位或改写业务事实。
