# ZERP Domain Language

ZERP uses shared business terms across its auxiliary-data, business-object, voucher, workflow, and business-ledger domains. This glossary fixes the meaning of terms that cross those domain boundaries.

## Authorization

**Delegation Ceiling（授权上限）**:
管理员可以向他人授予的权限范围。
_Avoid_: 角色管理权限等于全部权限、可授予未拥有权限
_Authority_: [APP 最终权限计算](docs/domains/app.md#4-最终权限计算)、[APP 角色管理](docs/domains/app.md#56-角色管理)

## Approval

**Approval Entry（审批条目）**:
中央 Approval 对一份持久化 Submission 的审批记录；它不为浏览器本地 Draft 建立条目。
_Avoid_: Domain 审批行、审批 Store Adapter、审批主体注册表
_Authority_: [Approval 领域](docs/domains/approval.md#2-审批条目与主体边界)

**Draft（本地草稿）**:
仅属于已认证用户当前浏览器与设备的 IndexedDB 编辑状态；它可以保存未完成输入、展示快照和待提交附件，但不是服务器业务事实、Approval 条目或跨设备协作对象。
_Avoid_: 服务端草稿、Approval `DRAFT`、共享候选、自动上传的业务附件
_Authority_: [Approval 草稿与 Submission](docs/domains/approval.md#2-审批条目与主体边界)

**Submission（提交件）**:
用户提交时在服务器事务中创建的不可变业务快照及其 Approval Entry；服务端为它分配版本、业务编号或时间等权威事实。删除一份开放 Submission 是资源删除，不产生 Approval 伪状态。
_Avoid_: 持久化草稿、可编辑提交件、`WITHDRAWN`、`REVOKED`、`unsubmit`
_Authority_: [Approval 草稿与 Submission](docs/domains/approval.md#2-审批条目与主体边界)

**Approval Lifecycle（审批生命周期）**:
中央 Approval 对 Submission 的 `PENDING | APPROVED | REJECTED` 生命周期管理。
_Avoid_: 领域自定义审批状态机
_Authority_: [Approval 生命周期](docs/domains/approval.md#3-生命周期)

**Approval Version（审批版本）**:
中央 Approval 为 DCL stable subject 管理的版本化审批记录；DCL 是申报版本的唯一业务写入方。
_Avoid_: 非 DCL Approval Version consumer、Domain 版本头、领域自有版本管理、分支或合并
_Authority_: [Approval Version](docs/domains/approval.md#6-approval-version)

**Approval Metadata（审批元数据）**:
HTTP 响应中表达 Approval 信息、供界面呈现的元数据。
_Avoid_: Domain 自定义审批元数据、按协议原码直接显示
_Authority_: [Approval 生命周期](docs/domains/approval.md#3-生命周期)

**Approval Action Availability（审批动作资格）**:
中央 Approval 根据审批条目事实、当前操作者和精确权限生成的查询时生命周期动作快照；动作执行仍重新验证全部权威事实和业务不变量。
_Avoid_: 前端动作推断、Domain 动作资格、把动作列表当作授权凭证
_Authority_: [Approval 动作资格](docs/domains/approval.md#32-approval-action-availability)

**Workbench Pending Stage（工作台待办阶段）**:
APP 工作台用于区分待提交与待批准任务的分类维度，不是 Approval Status，也不改变条目的真实审批状态。
_Avoid_: 待办状态、把 `SUBMIT` 或 `APPROVE` 显示为 Approval Status
_Authority_: [APP 工作台待办](docs/domains/app.md#工作台待办)

**Trusted System Actor（受信系统操作者）**:
用于执行中央 Approval 自动操作的系统身份。
_Avoid_: 把普通用户当作系统身份、绕过审批
_Authority_: [Approval 授权](docs/domains/approval.md#4-授权与事务边界)

## Business Objects

**Continuous Effectiveness（连续生效）**:
使用 Approval Version 的主数据在候选变更期间继续以最后有效版本供业务使用，候选审核后一次切换；AUX current data 则由保存直接生效，并由采用方 snapshot 隔离历史业务解释。两者都只有显式停用才立即阻止新引用。
_Avoid_: 编辑即停用、候选待审期间无可用版本、AUX 修改后重解释历史、逐页面决定变更期是否可用
_Authority_: [DCL current 投影边界](docs/domains/dcl.md#4-原子性与引用)、[AUX Stable-ID Direct CRUD](docs/domains/aux.md#2-stable-id-direct-crud-生命周期)、[APP 菜单模板](docs/domains/app.md#39-菜单模板)

**Business Identity Record（业务身份档案）**:
客户、供应商、员工、其他单位或销售合作方各自拥有的身份档案；同一现实个人或组织具有多种业务身份时分别建档、分别审批，不跨类型共享或同步身份资料。
_Avoid_: Party、主体主档、跨业务身份共享档案、自动识别同一现实主体

**Legal Identifier（法定识别号）**:
一种业务身份档案在其版本中保存的唯一法律身份号码。Customer 的客户身份资料中的法定识别号是精确 Customer Version 的 `legalIdentifier`：大陆企业、大陆个人或其他；前两者分别使用完整校验的统一社会信用代码与 18 位居民身份证，其他仅 trim 后在 Customer 内去重。Supplier、Employee、Other Unit 与 Sales Partner 保持各自既有身份范围，均只保存一个法定识别号。
_Avoid_: 强标识数组、标识类型、重复法定识别号、跨档案自动合并

**Person（个人）**:
业务身份档案所描述的自然人法律身份。
_Avoid_: 个人客户、兼职员工主体、跨业务身份共享的个人主档

**Organization（组织）**:
业务身份档案所描述的非自然人法律身份；当前不再细分企业、机构或其他组织类别。
_Avoid_: 企业主体、机构主体、跨业务身份共享的组织主档、没有业务规则用途的组织分类

**Customer（客户）**:
可以向我方任一经营主体下单的外部销售相对方，独立拥有法定身份、法定识别号及汇款识别资料；客户不维护可交易经营主体名单，默认经营主体只用于新单据预填，实际经营主体由每张单据明确保存。
_Avoid_: Party 的客户关系、按我方经营主体重复建立客户、客户经营主体白名单、把默认经营主体当作交易事实

**Employee（员工）**:
具有独立身份和雇佣资料，并且当前设置一个任职经营主体的内部人员档案；该设置描述任职归属，但不限制其他经营主体的业务单据选择该员工。
_Avoid_: Party 的雇佣关系、没有经营主体的员工、把任职经营主体当作跨主体单据选择权限、用销售合作方代替员工

**Business Identity Detail（业务身份资料）**:
法定名称、显示名称、法定识别号和联系资料等由一种业务身份档案独立维护和审批的资料；客户身份资料始终按精确 Customer Version 的 `legalIdentifier` 解释。
_Avoid_: Party 身份事实、跨客户与供应商同步、用另一种业务身份的当前值解释历史

**Business Archive Detail（业务档案资料）**:
业务编码、业务联系人、结算、信用、价格或岗位等只属于一种业务身份档案的资料。服务内容由合同和履约单据表达，不在其他单位档案上另设服务范围。
_Avoid_: Party 关系明细、任意键值属性、跨业务身份共享业务条件

**Business Object Reference（业务对象引用）**:
交易或核算对客户子单位、供应商、员工、其他单位或销售合作方等明确类型对象的引用；客户业务同时保存所属 Customer 和精确 Customer Approval Entry。
_Avoid_: Party 引用、对象 ID 加自由文本类型、用一个现实主体合并不同业务身份的往来余额

**Customer Subunit（客户子单位）**:
客户档案内承载名称、联系人、业务地址、客户类型、结算收款、运输定价、信用额度、业务归属、内部提示、订单默认值和业务附件，并分别核算应收、预收和信用占用的业务与核算分部；它具有客户内唯一且不可复用的编码和稳定 ID，但没有独立审批、版本或修订生命周期。
_Avoid_: 客户核算账户、客户结算账户、独立客户、独立审批对象、银行结算账户、Contact 实体

**Implicit Customer Subunit Choice（默认客户子单位）**:
启用 Customer 恰有一个启用客户子单位时，新业务可以派生采用该子单位；存在两个及以上启用子单位时没有默认值，业务单据必须明确选择并保存实际子单位。
_Avoid_: 持久化默认子单位、第一行默认、最低编码默认、最近使用默认、多个启用子单位时自动选择

**Operating Entity（经营主体）**:
我方实际承担合同销售方、开票方和收款方责任的法人公司；只有经营主体自身保留税号语义。
_Avoid_: 商品品牌、客户类型、报表标签、客户的固定归属主体、允许跨经营主体收款分摊
_Authority_: [DCL 经营主体申报](docs/domains/dcl.md#2-经营主体申报)、[BOB 领域边界](docs/domains/bob.md#2-领域职责与边界)、[VOU 编号、金额和引用](docs/domains/vou.md#21-编号金额和引用)

**Sales Receipt Allocation（销售收款分摊）**:
一笔客户来款分配到该客户下一个或多个客户子单位及其未结应收的金额明细；付款户名和付款银行账号等识别资料属于 Customer，不属于客户子单位。
_Avoid_: 依付款公司直接冲减共享余额、把一笔银行流水伪造为多笔来款
_Authority_: [VOU 往来收付款](docs/domains/vou.md#36-往来收款与往来付款)

**Invoicing Requirement（开票义务）**:
已经确认的销售收入需要开具发票或进入未开票收入申报的义务。
_Avoid_: 是否开票布尔值、由每张订单任意选择是否需要开票、按经营主体当前税号重分类历史
_Authority_: [VOU 往来收付款](docs/domains/vou.md#36-往来收款与往来付款)

**Sales Invoice（销售发票）**:
由一个经营主体向一个客户子单位开具的销售税务凭证；一张发票不得跨经营主体、跨 Customer 或跨客户子单位，购方名称、注册地址、开票电话、开户行及账号取自该子单位所属 Customer 的精确 Customer Version，购方的法定识别号就是该 Customer Version 的 `legalIdentifier`。
_Avoid_: 客户级跨子单位发票、发票分配到子单位、用付款主体代替客户子单位

**Supplier（供应商）**:
适用采购订单—仓库收货流程、独立维护和审批身份及采购资料的全局外部业务档案；它保存适用经营主体集合和集合内的默认经营主体。
_Avoid_: Party 的供应关系、按应付科目定义供应商
_Authority_: [BOB 领域边界](docs/domains/bob.md#2-领域职责与边界)

**Other Unit（其他单位）**:
适用服务合同—履约验收流程、独立维护和审批身份及服务资料的全局外部业务档案；它保存适用经营主体集合和集合内的默认经营主体。
_Avoid_: 其他往来单位、Party 的服务关系、按会计科目区分供应商与其他单位
_Authority_: [BOB 领域边界](docs/domains/bob.md#2-领域职责与边界)

**Vehicle Carrier Affiliation（车辆承运归属）**:
车辆唯一归属的承运责任方；自有车辆归属一个经营主体，外部车辆直接归属一个其他单位档案。
_Avoid_: 物流平台、为自有车辆虚构其他单位、每张送货单临时改变车辆归属
_Authority_: [BOB 车辆承运归属](docs/domains/bob.md#24-车辆承运归属)

**Customer Type（客户类型）**:
客户子单位的可配置业务分类。
_Avoid_: 宣称客户类型当前决定售价、把价格和业绩公式塞进字典项、固定写死两个类型
_Authority_: [BOB 业务字段](docs/domains/bob.md#21-业务字段)、[VOU 编号、金额和引用](docs/domains/vou.md#21-编号金额和引用)

**Settlement Method Snapshot（结算方式快照）**:
客户子单位或 Supplier 版本直接拥有的结算时间事实副本。
_Avoid_: 制单时逐层解析结算方式版本、只保存结算方式 ID、把采购单据费用混入结算时间规则
_Authority_: [AUX 结算方式](docs/domains/aux.md#33-结算方式)、[BOB 客户与供应商结算方式快照](docs/domains/bob.md#22-客户与供应商结算方式快照)

**Settlement Timing（结算时间规则）**:
预付、现结、货到若干天、当月结或月结若干天等“何时应付款”的规则，由客户子单位或 Supplier 结算方式快照表达。
_Avoid_: 把银承、电汇、现金等付款媒介当作月结规则
_Authority_: [AUX 结算方式](docs/domains/aux.md#33-结算方式)、[VOU 编号、金额和引用](docs/domains/vou.md#21-编号金额和引用)

**Payment Method Snapshot（收款方式快照）**:
客户子单位或销售单据直接拥有的付款媒介及其销售价格影响副本。
_Avoid_: 承兑类型、`cd_type`、把收款方式合并进结算时间规则
_Authority_: [AUX 收款方式](docs/domains/aux.md#34-收款方式)、[VOU 编号、金额和引用](docs/domains/vou.md#21-编号金额和引用)

**Customer Transport Policy（客户运输政策）**:
客户子单位约定的默认运输方式和运输加价。
_Avoid_: 从当前客户子单位资料回算历史订单、把运输方式和运输价格混成一个字段
_Authority_: [BOB 业务字段](docs/domains/bob.md#21-业务字段)、[VOU 编号、金额和引用](docs/domains/vou.md#21-编号金额和引用)

**Sales Cost Component（销售成本组成）**:
为了履行一笔销售而发生、需要由成交价覆盖的具名成本。
_Avoid_: 其他加价、无法说明来源或去向的成本
_Authority_: [BOB 业务字段](docs/domains/bob.md#21-业务字段)、[VOU 编号、金额和引用](docs/domains/vou.md#21-编号金额和引用)

**Sales Premium（销售溢价）**:
在基础报价和全部销售成本组成之上额外加入成交价的非负单位金额。
_Avoid_: 额外利润、与成本或优惠混记
_Authority_: [BOB 业务字段](docs/domains/bob.md#21-业务字段)

**Sales Discount（销售优惠）**:
从自动价格中向下扣减的非负单位价格。
_Avoid_: 负溢价、用有符号价格字段同时表达利润和优惠
_Authority_: [BOB 业务字段](docs/domains/bob.md#21-业务字段)、[VOU 编号、金额和引用](docs/domains/vou.md#21-编号金额和引用)

**Customer Sales Attribution（客户业务归属）**:
客户子单位的主要业务归属。
_Avoid_: 同一客户同时配置多个主要业务归属、把不具名第三方居间另建为客户资料中的具名收款方
_Authority_: [BOB 业务字段](docs/domains/bob.md#21-业务字段)、[VOU 居间计算单](docs/domains/vou.md#24-居间计算单)

**Sales Partner（销售合作方）**:
承接外部兼职销售或渠道拓客，并据此取得销售服务收益或渠道差价的全局业务档案；它保存适用经营主体集合和集合内的默认经营主体，同一档案可以同时具备兼职销售和渠道商能力。
_Avoid_: Party 的销售合作关系、员工、其他单位、把所有购买商品的客户称为销售合作方
_Authority_: [BOB 业务字段](docs/domains/bob.md#21-业务字段)、[VOU 居间计算单](docs/domains/vou.md#24-居间计算单)

**Channel Partner（渠道商）**:
销售合作方“通过拓展其他客户取得渠道差价”的能力；购买我方商品本身只形成客户档案，同一现实主体可以分别建立客户和销售合作方档案。
_Avoid_: 经销商客户、把渠道商固定为一种客户类型、把所有销售合作方统称为渠道商
_Authority_: [BOB 业务字段](docs/domains/bob.md#21-业务字段)、[VOU 居间计算单](docs/domains/vou.md#24-居间计算单)

**Default Purchaser（默认采购员）**:
供应商为新采购订单提供的我方默认经办员工。
_Avoid_: 供应商业务员、`salespersonEmployeeId`、把供应商联系人引用为我方员工
_Authority_: [BOB 业务字段](docs/domains/bob.md#21-业务字段)、[VOU 编号、金额和引用](docs/domains/vou.md#21-编号金额和引用)

**Product Type（产品类型）**:
用于组织产品主数据的可扩展 AUX 分类；每个产品类型绑定一个系统内置行为模板，但不自行保存任意规则开关。
_Avoid_: 固定四种产品类型、产品行为配置包、产品分类树
_Authority_: [AUX 产品类型](docs/domains/aux.md#311-产品类型)、[BOB 业务字段](docs/domains/bob.md#21-业务字段)

**Product Behavior Profile（产品行为模板）**:
系统内置的产品规则组合，决定固定配方、订单配方、默认包装规格和包装物行为；业务用户可以扩展产品类型，但新增行为模板必须修改领域规则和系统实现。
_Avoid_: 产品类型名称、管理员自定义行为开关、产品类型 ID 硬编码
_Authority_: [AUX 产品类型](docs/domains/aux.md#311-产品类型)、[BOB 业务字段](docs/domains/bob.md#21-业务字段)

**Delivery Specification（交付规格）**:
销售订单行选择的实际交付形态，可以是桶装等有包装规格或散水规格；它属于订单事实，不是产品属性或产品可选规格集合。
_Avoid_: 产品交付规格、库存单位、把槽车当作可换算单位
_Authority_: [VOU 编号、金额和引用](docs/domains/vou.md#21-编号金额和引用)

**Default Packaging Specification（默认包装规格）**:
非包装产品版本内必须维护的正数，表示一标准包装件对应的基准数量；它没有独立身份、版本或生命周期，是桶装订单的标准计件口径。
_Avoid_: 包装规格对象、包装规格版本、产品交付规格列表、客户包装要求
_Authority_: [BOB 业务字段](docs/domains/bob.md#21-业务字段)、[VOU 编号、金额和引用](docs/domains/vou.md#21-编号金额和引用)

**Bulk Liquid（散水）**:
不装入包装物、必须通过具备散水承运能力的槽车运输的液体交付规格；槽车只承担运输，不代表固定产品数量，居间标准计件另按每 1000 基准数量一标准件计算。
_Avoid_: 无包装、一车、把槽车容量作为单位换算率
_Authority_: [BOB 业务字段](docs/domains/bob.md#21-业务字段)、[VOU 销售四单](docs/domains/vou.md#32-销售四单)

**Standard Piece Quantity（标准计件数）**:
用于居间收益的等价件数；桶装等有包装订单按产品版本内的默认包装规格折算，散水订单固定按每 1000 基准数量一标准件折算。结果允许小数，最多保留六位小数，不按整数件取整。
_Avoid_: 实际桶数、订单包装件数、库存数量、`barrelQuantity`
_Authority_: [BOB 业务字段](docs/domains/bob.md#21-业务字段)、[VOU 居间计算单](docs/domains/vou.md#24-居间计算单)

**Base Unit（基准单位）**:
每个产品内部用于保存、汇总和比较数量的抽象尺度；它没有 AUX 对象、名称、符号或可管理 ID，产品类型也不改变该尺度。
_Avoid_: 计量单位、默认录入单位、计价单位、基准单位下拉框
_Authority_: [AUX 计量单位](docs/domains/aux.md#35-计量单位)、[BOB 业务字段](docs/domains/bob.md#21-业务字段)、[ACC 库存数量账与控制](docs/domains/acc.md#9-库存数量账与控制)

**Unit Conversion（单位换算）**:
产品页面为方便用户录入而维护的“计量单位数量到建议基准数量”换算工具；产品能够选择的默认录入单位、计价单位和其他录入单位都必须具有对应换算。它不产生权威业务事实，后端、配方和台账都不得依赖换算结果重新解释数量。
_Avoid_: 权威换算、后端自动换算、历史重算依据、标准计件口径
_Authority_: [BOB 业务字段](docs/domains/bob.md#21-业务字段)

**Base Quantity（基准数量）**:
按产品抽象基准尺度表达的权威数量事实；业务单据同时留存录入数量和单位供审计，但配方、履约、库存和成本只消费这个无单位数值。
_Avoid_: 换算结果、带单位库存数量、从当前单位换算反推历史基准数量
_Authority_: [VOU 编号、金额和引用](docs/domains/vou.md#21-编号金额和引用)、[ACC 库存数量账与控制](docs/domains/acc.md#9-库存数量账与控制)

**Third-party Intermediary Cost（第三方居间成本）**:
为不具名第三方居间预留的销售成本。
_Avoid_: 要求客户资料绑定具名收款方、把客户优惠或员工销售提成解释为第三方居间成本
_Authority_: [BOB 业务字段](docs/domains/bob.md#21-业务字段)、[VOU 居间计算单](docs/domains/vou.md#24-居间计算单)

**Customer Credit Limit（客户信用额度）**:
客户子单位在单一交易币种内获批的最大信用占用。
_Avoid_: 按业务员或集团汇总客户额度、只提醒不控制、跨币种直接相加
_Authority_: [VOU 编号、金额和引用](docs/domains/vou.md#21-编号金额和引用)、[ACC 会计期间](docs/domains/acc.md#10-会计期间)

**Customer Internal Reminder（客户内部提醒）**:
客户子单位资料中的内部业务提示。
_Avoid_: 客户备注、自动进入对外单据
_Authority_: [BOB 业务字段](docs/domains/bob.md#21-业务字段)

**Default Sales Order Remark（默认销售订单备注）**:
客户子单位为新销售订单提供的默认备注。
_Avoid_: 客户内部提醒、订单保存后继续回查客户当前值
_Authority_: [VOU 编号、金额和引用](docs/domains/vou.md#21-编号金额和引用)

## Navigation

**APP Page Route（APP 页面路由）**:
APP 领域页面在菜单目录和前端路由中使用的稳定 `routeKey` 与 `routePath`。
_Avoid_: admin 领域、`admin/*` 管理页面路由、把页面路由等同于 API 动作路径
_Authority_: [APP 菜单模板](docs/domains/app.md#39-菜单模板)

## Configuration

**Enterprise Display Name（企业名称）**:
当前 ZERP 使用单位在登录页和登录后顶栏显示的名称；它是 APP 系统参数，不代表业务身份档案、经营主体或产品名。
_Avoid_: 租户名称、业务身份档案名称、经营主体名称、用企业名称替换产品名 ZERP
_Authority_: [APP 系统参数](docs/domains/app.md#38-系统参数)

**Configured Value（配置值）**:
已登记系统参数当前持久化的目标值。
_Avoid_: 当前值、已生效值
_Authority_: [APP 系统参数](docs/domains/app.md#38-系统参数)

**Running Value（运行值）**:
运行实例已经采用的系统参数值。
_Avoid_: 推测已生效的配置值
_Authority_: [APP 系统参数](docs/domains/app.md#38-系统参数)

**Effect Mode（生效模式）**:
系统参数值从配置值影响运行行为的既定方式。
_Avoid_: 页面重启、未说明的生效时机
_Authority_: [APP 系统参数](docs/domains/app.md#38-系统参数)

## Accounting

**Accounting Opening（会计期初）**:
一个会计账簿的 Approval-only 期初主体；它没有版本号，本地 Draft submit 后使用中央 `PENDING`、`APPROVED`、`REJECTED` 生命周期。
_Avoid_: `state`、局部批准人/时间字段、期初版本
_Authority_: [ACC 账簿期初](docs/domains/acc.md#6-账簿期初)

**Accounting Mapping（会计映射）**:
以 `(bookId, vouEntity)` 为稳定主体的 Approval Version，由 DCL 拥有声明、候选、版本和审批生命周期；ACC 只读取最新 `APPROVED` entry 作为当前记账映射，候选不参与记账。
_Avoid_: mapping version header、当前映射指针、候选参与记账、ACC 维护映射版本
_Authority_: [DCL 会计映射申报](docs/domains/dcl.md#38-会计映射申报)、[ACC 当前记账映射](docs/domains/acc.md#7-当前记账映射)

**Accounting Subject（会计科目）**:
归 ACC 领域和单本会计账簿所有的分层会计分类。
_Avoid_: AUX 会计科目、全局会计科目
_Authority_: [ACC 会计科目](docs/domains/acc.md#5-会计科目)

## Reporting

**Report Definition（报表定义）**:
由 DCL subject 保存 stable ID、code 与创建审计；每个不可变业务版本（包括 enabled）由一个 Approval Version entry 的 typed snapshot 承载，RPT 以该 entry 保存技术有效性与运行审计，最新 `APPROVED + enabled + VALID` entry 是唯一执行版本。
_Avoid_: `currentVersionId`、历史版本回退、候选执行
_Authority_: [DCL 报表定义申报](docs/domains/dcl.md#39-报表定义申报)、[RPT 当前执行规则](docs/domains/rpt.md#3-报表定义与-dcl)

## Workflow

**Workflow Definition（流程定义）**:
具有稳定 code 的 Starlark 流程主体；脚本和编译图属于 Approval Version entry，`enabled` 是与 Approval 独立的布尔运行开关。
_Avoid_: publish、published revision、以启停代替审批
_Authority_: [WFL 定义与 Approval Version](docs/domains/wfl.md#2-定义与-approval-version)

**Workflow Instance Definition Entry（流程实例定义条目）**:
实例启动时固定的已批准流程定义 `approvalEntryId`；该 entry 对应的不可变脚本持续驱动该实例，即使随后出现新版本或定义停用。
_Avoid_: fixed published revision、实例跟随最新版本
_Authority_: [WFL 事件、实例与幂等](docs/domains/wfl.md#4-事件实例与幂等)

## Voucher Lifecycle

**Voucher Posting（单据入账）**:
VOU 单据产生业务台账事实的动作。
_Avoid_: 最终处理、业务完成
_Authority_: [VOU 生命周期](docs/domains/vou.md#22-生命周期)、[ACC VOU 自动记账与删除](docs/domains/acc.md#8-vou-自动记账与删除)

## Other Dealings

**Other Dealings Ledger（其他往来台账）**:
记录销售、采购往来之外其他债权与债务的台账。
_Avoid_: 其他单位台账、员工借款台账
_Authority_: [AUX 收支类型](docs/domains/aux.md#37-收支类型)、[ACC 会计科目](docs/domains/acc.md#5-会计科目)

**Other Dealings Subject（其他往来主体）**:
其他往来的权利义务对象。
_Avoid_: 其他单位
_Authority_: [ACC 会计科目](docs/domains/acc.md#5-会计科目)

**Other Dealings Category（其他往来类别）**:
其他往来流水的可选业务分类。
_Avoid_: 单据类型、主体类型
_Authority_: [AUX 收支类型](docs/domains/aux.md#37-收支类型)
