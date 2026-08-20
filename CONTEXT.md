# ZERP Domain Language

ZERP uses shared business terms across its auxiliary-data, business-object, voucher, workflow, and business-ledger domains. This glossary fixes the meaning of terms that cross those domain boundaries.

## Authorization

**Delegation Ceiling（授权上限）**:
管理员可以向他人授予的权限范围。
_Avoid_: 角色管理权限等于全部权限、可授予未拥有权限
_Rules_: [APP 最终权限计算](docs/domains/app.md#4-最终权限计算)、[APP 角色管理](docs/domains/app.md#57-角色管理)

## Business Objects

**Customer Account（客户结算子账户）**:
与本企业发生具体销售并独立结算的客户账户。
_Avoid_: 用共享付款公司合并多个客户的账期和应收、共享业务伙伴角色
_Rules_: [BOB 领域边界](docs/domains/bob.md#2-领域职责与边界)、[VOU 往来收付款](docs/domains/vou.md#36-往来收款与往来付款)、[ACC 会计期间](docs/domains/acc.md#10-会计期间)

**Customer Group（集团客户）**:
归集一个或多个客户结算子账户的收款识别根。
_Avoid_: 集团统一应收或信用额度、集团规则由子账户继承覆盖、只在多客户特例时临时建组
_Rules_: [BOB 领域边界](docs/domains/bob.md#2-领域职责与边界)

**Operating Entity（经营主体）**:
我方实际承担合同销售方、开票方和收款方责任的法人公司。
_Avoid_: 商品品牌、客户类型、报表标签、允许跨经营主体收款分摊
_Rules_: [BOB 领域边界](docs/domains/bob.md#2-领域职责与边界)、[VOU 编号、金额和引用](docs/domains/vou.md#21-编号金额和引用)

**Sales Receipt Allocation（销售收款分摊）**:
一笔集团客户来款分配到具体客户结算子账户及其未结应收的金额明细。
_Avoid_: 依付款公司直接冲减共享余额、把一笔银行流水伪造为多笔来款
_Rules_: [VOU 往来收付款](docs/domains/vou.md#36-往来收款与往来付款)

**Invoicing Requirement（开票义务）**:
已经确认的销售收入需要开具发票或进入未开票收入申报的义务。
_Avoid_: 是否开票布尔值、由每张订单任意选择是否需要开票、按集团当前税号重分类历史
_Rules_: [VOU 往来收付款](docs/domains/vou.md#36-往来收款与往来付款)

**Supplier（供应商）**:
与本企业发生采购或物流服务关系的独立 BOB 业务对象。相同税号的客户集团或其他往来单位不与其共享身份、生命周期或编码。
_Avoid_: 共享业务伙伴下的供应商角色
_Rules_: [BOB 领域边界](docs/domains/bob.md#2-领域职责与边界)

**Other Dealings Unit（其他往来单位）**:
承担销售、采购之外其他债权债务关系的独立 BOB 业务对象。
_Avoid_: 共享业务伙伴下的其他往来角色
_Rules_: [BOB 领域边界](docs/domains/bob.md#2-领域职责与边界)

**Customer Type（客户类型）**:
客户的可配置业务分类。
_Avoid_: 宣称客户类型当前决定售价、把价格和业绩公式塞进字典项、固定写死两个类型
_Rules_: [BOB 业务字段](docs/domains/bob.md#21-业务字段)、[VOU 编号、金额和引用](docs/domains/vou.md#21-编号金额和引用)

**Settlement Method Snapshot（结算方式快照）**:
客户或供应商版本直接拥有的结算时间事实副本。
_Avoid_: 制单时逐层解析结算方式版本、只保存结算方式 ID、把采购单据费用混入结算时间规则
_Rules_: [AUX 结算方式](docs/domains/aux.md#33-结算方式)、[BOB 客户与供应商结算方式快照](docs/domains/bob.md#22-客户与供应商结算方式快照)

**Settlement Timing（结算时间规则）**:
预付、现结、货到若干天、当月结或月结若干天等“何时应付款”的规则，由客户或供应商结算方式快照表达。
_Avoid_: 把银承、电汇、现金等付款媒介当作月结规则
_Rules_: [AUX 结算方式](docs/domains/aux.md#33-结算方式)、[VOU 编号、金额和引用](docs/domains/vou.md#21-编号金额和引用)

**Payment Method Snapshot（收款方式快照）**:
客户版本或销售单据直接拥有的付款媒介及其销售价格影响副本。
_Avoid_: 承兑类型、`cd_type`、把收款方式合并进结算时间规则
_Rules_: [AUX 收款方式](docs/domains/aux.md#34-收款方式)、[VOU 编号、金额和引用](docs/domains/vou.md#21-编号金额和引用)

**Customer Transport Policy（客户运输政策）**:
客户约定的默认运输方式和运输加价。
_Avoid_: 从当前客户资料回算历史订单、把运输方式和运输价格混成一个字段
_Rules_: [BOB 业务字段](docs/domains/bob.md#21-业务字段)、[VOU 编号、金额和引用](docs/domains/vou.md#21-编号金额和引用)

**Sales Cost Component（销售成本组成）**:
为了履行一笔销售而发生、需要由成交价覆盖的具名成本。
_Avoid_: 其他加价、无法说明来源或去向的成本
_Rules_: [BOB 业务字段](docs/domains/bob.md#21-业务字段)、[VOU 编号、金额和引用](docs/domains/vou.md#21-编号金额和引用)

**Sales Premium（销售溢价）**:
在基础报价和全部销售成本组成之上额外加入成交价的非负单位金额。
_Avoid_: 额外利润、与成本或优惠混记
_Rules_: [BOB 业务字段](docs/domains/bob.md#21-业务字段)

**Sales Discount（销售优惠）**:
从自动价格中向下扣减的非负单位价格。
_Avoid_: 负溢价、用有符号价格字段同时表达利润和优惠
_Rules_: [BOB 业务字段](docs/domains/bob.md#21-业务字段)、[VOU 编号、金额和引用](docs/domains/vou.md#21-编号金额和引用)

**Customer Sales Attribution（客户业务归属）**:
客户结算子账户的主要业务关系。
_Avoid_: 同一客户同时配置多个主要业务归属、把不具名第三方居间另建为客户资料中的具名收款方
_Rules_: [BOB 业务字段](docs/domains/bob.md#21-业务字段)、[VOU 居间计算单](docs/domains/vou.md#24-居间计算单)

**Default Purchaser（默认采购员）**:
供应商为新采购订单提供的我方默认经办员工。
_Avoid_: 供应商业务员、`salespersonEmployeeId`、把供应商联系人引用为我方员工
_Rules_: [BOB 业务字段](docs/domains/bob.md#21-业务字段)、[VOU 编号、金额和引用](docs/domains/vou.md#21-编号金额和引用)

**Third-party Intermediary Cost（第三方居间成本）**:
为不具名第三方居间预留的销售成本。
_Avoid_: 要求客户资料绑定具名收款方、把 `fd_price` 解释为客户返点、把员工销售提成统称为第三方居间费
_Rules_: [BOB 业务字段](docs/domains/bob.md#21-业务字段)、[VOU 居间计算单](docs/domains/vou.md#24-居间计算单)

**Customer Credit Limit（客户信用额度）**:
客户结算子账户在单一交易币种内获批的最大信用占用。
_Avoid_: 按业务员或集团汇总客户额度、只提醒不控制、跨币种直接相加
_Rules_: [VOU 编号、金额和引用](docs/domains/vou.md#21-编号金额和引用)、[ACC 会计期间](docs/domains/acc.md#10-会计期间)

**Customer Internal Reminder（客户内部提醒）**:
客户资料中的内部业务提示。
_Avoid_: 客户备注、自动进入对外单据
_Rules_: [BOB 业务字段](docs/domains/bob.md#21-业务字段)

**Default Sales Order Remark（默认销售订单备注）**:
客户为新销售订单提供的默认备注。
_Avoid_: 客户内部提醒、订单保存后继续回查客户当前值
_Rules_: [VOU 编号、金额和引用](docs/domains/vou.md#21-编号金额和引用)

**Transferable BOB Reference（可转移 BOB 关联）**:
当前有效 BOB 版本中直接引用另一个当前 BOB 对象的业务字段。
_Avoid_: 只处理客户业务员、按页面硬编码关联白名单、改写历史操作者或交易快照
_Rules_: [BOB 关联批量转移](docs/domains/bob.md#422-bob-关联批量转移)

## Navigation

**APP Page Route（APP 页面路由）**:
APP 领域页面在菜单目录和前端路由中使用的稳定 `routeKey` 与 `routePath`。
_Avoid_: admin 领域、`admin/*` 管理页面路由、把页面路由等同于 API 动作路径
_Rules_: [APP 菜单模板](docs/domains/app.md#39-菜单模板)

## Configuration

**Configured Value（配置值）**:
已登记系统参数当前持久化的目标值。
_Avoid_: 当前值、已生效值
_Rules_: [APP 系统参数](docs/domains/app.md#38-系统参数)

**Running Value（运行值）**:
运行实例已经采用的系统参数值。
_Avoid_: 推测已生效的配置值
_Rules_: [APP 系统参数](docs/domains/app.md#38-系统参数)

**Effect Mode（生效模式）**:
系统参数值从配置值影响运行行为的既定方式。
_Avoid_: 页面重启、未说明的生效时机
_Rules_: [APP 系统参数](docs/domains/app.md#38-系统参数)

## Accounting

**Accounting Subject（会计科目）**:
归 ACC 领域和单本会计账簿所有的分层会计分类。
_Avoid_: AUX 会计科目、全局会计科目
_Rules_: [ACC 会计科目](docs/domains/acc.md#5-会计科目)

## Voucher Lifecycle

**Voucher Posting（单据入账）**:
VOU 单据产生业务台账事实的动作。
_Avoid_: 最终处理、业务完成
_Rules_: [VOU 生命周期](docs/domains/vou.md#22-生命周期)、[ACC VOU 自动记账与删除](docs/domains/acc.md#8-vou-自动记账与删除)

## Other Dealings

**Other Dealings Ledger（其他往来台账）**:
记录销售、采购往来之外其他债权与债务的台账。
_Avoid_: 其他单位台账、员工借款台账
_Rules_: [AUX 收支类型](docs/domains/aux.md#37-收支类型)、[ACC 会计科目](docs/domains/acc.md#5-会计科目)

**Other Dealings Subject（其他往来主体）**:
其他往来的权利义务对象。
_Avoid_: 其他往来单位
_Rules_: [ACC 会计科目](docs/domains/acc.md#5-会计科目)

**Other Dealings Category（其他往来类别）**:
其他往来流水的可选业务分类。
_Avoid_: 单据类型、主体类型
_Rules_: [AUX 收支类型](docs/domains/aux.md#37-收支类型)
