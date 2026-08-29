# ZERP Domain Language

ZERP uses shared business terms across its auxiliary-data, business-object, voucher, workflow, and business-ledger domains. This glossary fixes the meaning of terms that cross those domain boundaries.

## Authorization

**Delegation Ceiling（授权上限）**:
管理员可以向他人授予的权限范围。
_Avoid_: 角色管理权限等于全部权限、可授予未拥有权限
_Authority_: [APP 最终权限计算](docs/domains/app.md#4-最终权限计算)、[APP 角色管理](docs/domains/app.md#56-角色管理)

## Approval

**Approval Entry（审批条目）**:
中央 Approval 对稳定业务主体的审批记录。
_Avoid_: Domain 审批行、审批 Store Adapter、审批主体注册表
_Authority_: [Approval 领域](docs/domains/approval.md#2-审批条目与主体边界)

**Approval Lifecycle（审批生命周期）**:
中央 Approval 对审批条目的生命周期管理。
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

**Trusted System Actor（受信系统操作者）**:
用于执行中央 Approval 自动操作的系统身份。
_Avoid_: 把普通用户当作系统身份、绕过审批
_Authority_: [Approval 授权](docs/domains/approval.md#4-授权与事务边界)

## Business Objects

**Continuous Effectiveness（连续生效）**:
使用 Approval Version 的主数据在候选变更期间继续以最后有效版本供业务使用，候选审核后一次切换；AUX current data 则由保存直接生效，并由采用方 snapshot 隔离历史业务解释。两者都只有显式停用才立即阻止新引用。
_Avoid_: 编辑即停用、候选待审期间无可用版本、AUX 修改后重解释历史、逐页面决定变更期是否可用
_Authority_: [DCL current 投影边界](docs/domains/dcl.md#4-原子性与引用)、[AUX Stable-ID Direct CRUD](docs/domains/aux.md#2-stable-id-direct-crud-生命周期)、[APP 菜单模板](docs/domains/app.md#39-菜单模板)

**Party（主体）**:
现实中的个人或组织，是名称、身份标识和联系资料等共享身份事实的唯一根；同一主体可以同时拥有多种业务关系。
_Avoid_: 业务伙伴、客户主体、供应商主体、为每种业务身份重复建档
_Authority_: [BOB 领域边界](docs/domains/bob.md#2-领域职责与边界)

**Person（个人）**:
以自然人身份参与业务的主体。
_Avoid_: 个人客户、兼职员工主体、把人员身份与雇佣或销售合作关系混为一体
_Authority_: [BOB 领域边界](docs/domains/bob.md#2-领域职责与边界)

**Organization（组织）**:
以非自然人身份参与业务的主体；当前不再细分企业、机构或其他组织类别。
_Avoid_: 企业主体、机构主体、没有业务规则用途的组织分类
_Authority_: [BOB 领域边界](docs/domains/bob.md#2-领域职责与边界)

**Business Relationship（业务关系）**:
外部主体与一个我方经营主体之间的强类型业务关系，拥有该业务专属资料和生命周期；客户、供应、雇佣、服务和销售合作分别使用自己的关系定义。同一外部主体面对不同经营主体时分别建立关系。
_Avoid_: 主体类型、可任意扩展字段的万能关系、用 JSON 或 EAV 保存正式关系属性
_Authority_: [BOB 领域边界](docs/domains/bob.md#2-领域职责与边界)

**Party Identity Fact（主体身份事实）**:
名称、身份标识、税号和通用联系资料等与具体业务关系无关、由同一主体共享的当前资料。
_Avoid_: 在每条客户、供应、服务或销售合作关系中复制主体身份、把结算或信用资料放入主体
_Authority_: [BOB 领域边界](docs/domains/bob.md#2-领域职责与边界)

**Party Merge（主体合并）**:
把误建的重复主体归入一个保留主体，并转移不冲突的当前业务关系；历史交易和关系快照保持原事实。
_Avoid_: 自动合并、覆盖同类型关系、删除来源主体或改写历史快照
_Authority_: [BOB 主体合并](docs/domains/bob.md#41-主体合并)

**Relationship Detail（关系明细）**:
业务编码、业务联系人、结算、信用、价格或岗位等只属于一条具体业务关系的资料。服务内容由合同和履约单据表达，不在服务关系上另设服务范围。
_Avoid_: 主体身份资料、任意键值属性、跨经营主体共享业务条件
_Authority_: [BOB 领域边界](docs/domains/bob.md#2-领域职责与边界)

**Relationship Reference（关系引用）**:
交易或核算对一个强类型业务关系或其交易子账户的引用，用来确定业务身份和经营主体边界。
_Avoid_: 裸主体引用、主体 ID 加自由文本关系类型、把同一主体的不同往来余额合并
_Authority_: [BOB 有效引用](docs/domains/bob.md#8-有效引用规则)、[ACC 会计科目](docs/domains/acc.md#5-会计科目)

**Customer Account（客户结算子账户）**:
客户关系中发生具体销售并独立结算的账户。
_Avoid_: 主体、用共享付款公司合并多个结算账户的账期和应收
_Authority_: [BOB 领域边界](docs/domains/bob.md#2-领域职责与边界)、[VOU 往来收付款](docs/domains/vou.md#36-往来收款与往来付款)、[ACC 会计期间](docs/domains/acc.md#10-会计期间)

**Operating Entity（经营主体）**:
我方实际承担合同销售方、开票方和收款方责任的法人公司。
_Avoid_: 商品品牌、客户类型、报表标签、允许跨经营主体收款分摊
_Authority_: [DCL 经营主体申报](docs/domains/dcl.md#2-经营主体申报)、[BOB 领域边界](docs/domains/bob.md#2-领域职责与边界)、[VOU 编号、金额和引用](docs/domains/vou.md#21-编号金额和引用)

**Sales Receipt Allocation（销售收款分摊）**:
一笔客户关系来款分配到该关系下具体客户结算子账户及其未结应收的金额明细。
_Avoid_: 依付款公司直接冲减共享余额、把一笔银行流水伪造为多笔来款
_Authority_: [VOU 往来收付款](docs/domains/vou.md#36-往来收款与往来付款)

**Invoicing Requirement（开票义务）**:
已经确认的销售收入需要开具发票或进入未开票收入申报的义务。
_Avoid_: 是否开票布尔值、由每张订单任意选择是否需要开票、按集团当前税号重分类历史
_Authority_: [VOU 往来收付款](docs/domains/vou.md#36-往来收款与往来付款)

**Supplier（供应商）**:
主体与本企业之间适用采购订单—仓库收货流程的供应关系。
_Avoid_: 供应商主体、按应付科目定义供应商
_Authority_: [BOB 领域边界](docs/domains/bob.md#2-领域职责与边界)

**Other Unit（其他单位）**:
用户页面对服务关系的称呼；主体与本企业之间适用服务合同—履约验收流程，与供应商的主要区别是业务流程，而不是 ACC 往来科目。
_Avoid_: 其他往来单位、其他单位主体、按会计科目区分供应商与其他单位
_Authority_: [BOB 领域边界](docs/domains/bob.md#2-领域职责与边界)

**Vehicle Carrier Affiliation（车辆承运归属）**:
车辆唯一归属的承运责任方；自有车辆归属一个经营主体，外部车辆归属一条“其他单位”服务关系。
_Avoid_: 物流平台、为自有车辆虚构其他单位、每张送货单临时改变车辆归属
_Authority_: [BOB 车辆承运归属](docs/domains/bob.md#24-车辆承运归属)

**Customer Type（客户类型）**:
客户的可配置业务分类。
_Avoid_: 宣称客户类型当前决定售价、把价格和业绩公式塞进字典项、固定写死两个类型
_Authority_: [BOB 业务字段](docs/domains/bob.md#21-业务字段)、[VOU 编号、金额和引用](docs/domains/vou.md#21-编号金额和引用)

**Settlement Method Snapshot（结算方式快照）**:
客户或供应商版本直接拥有的结算时间事实副本。
_Avoid_: 制单时逐层解析结算方式版本、只保存结算方式 ID、把采购单据费用混入结算时间规则
_Authority_: [AUX 结算方式](docs/domains/aux.md#33-结算方式)、[BOB 客户与供应商结算方式快照](docs/domains/bob.md#22-客户与供应商结算方式快照)

**Settlement Timing（结算时间规则）**:
预付、现结、货到若干天、当月结或月结若干天等“何时应付款”的规则，由客户或供应商结算方式快照表达。
_Avoid_: 把银承、电汇、现金等付款媒介当作月结规则
_Authority_: [AUX 结算方式](docs/domains/aux.md#33-结算方式)、[VOU 编号、金额和引用](docs/domains/vou.md#21-编号金额和引用)

**Payment Method Snapshot（收款方式快照）**:
客户版本或销售单据直接拥有的付款媒介及其销售价格影响副本。
_Avoid_: 承兑类型、`cd_type`、把收款方式合并进结算时间规则
_Authority_: [AUX 收款方式](docs/domains/aux.md#34-收款方式)、[VOU 编号、金额和引用](docs/domains/vou.md#21-编号金额和引用)

**Customer Transport Policy（客户运输政策）**:
客户约定的默认运输方式和运输加价。
_Avoid_: 从当前客户资料回算历史订单、把运输方式和运输价格混成一个字段
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
客户结算子账户的主要业务关系。
_Avoid_: 同一客户同时配置多个主要业务归属、把不具名第三方居间另建为客户资料中的具名收款方
_Authority_: [BOB 业务字段](docs/domains/bob.md#21-业务字段)、[VOU 居间计算单](docs/domains/vou.md#24-居间计算单)

**Sales Partner（销售合作方）**:
主体与本企业之间承接外部兼职销售或渠道拓客，并据此取得销售服务收益或渠道差价的独立销售合作关系；个人或组织都可建立，同一关系可以同时具备兼职销售和渠道商能力。
_Avoid_: 销售合作方主体、员工、其他单位、把所有购买商品的客户称为销售合作方
_Authority_: [BOB 业务字段](docs/domains/bob.md#21-业务字段)、[VOU 居间计算单](docs/domains/vou.md#24-居间计算单)

**Channel Partner（渠道商）**:
销售合作关系上“通过拓展其他客户取得渠道差价”的能力；购买我方商品本身只形成客户关系，同一主体可以同时拥有客户关系和渠道商能力，但不得把自己的客户关系归属给自己。
_Avoid_: 经销商客户、把渠道商固定为一种客户类型、把所有销售合作关系统称为渠道关系
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
_Avoid_: 要求客户资料绑定具名收款方、把 `fd_price` 解释为客户返点、把员工销售提成统称为第三方居间费
_Authority_: [BOB 业务字段](docs/domains/bob.md#21-业务字段)、[VOU 居间计算单](docs/domains/vou.md#24-居间计算单)

**Customer Credit Limit（客户信用额度）**:
客户结算子账户在单一交易币种内获批的最大信用占用。
_Avoid_: 按业务员或集团汇总客户额度、只提醒不控制、跨币种直接相加
_Authority_: [VOU 编号、金额和引用](docs/domains/vou.md#21-编号金额和引用)、[ACC 会计期间](docs/domains/acc.md#10-会计期间)

**Customer Internal Reminder（客户内部提醒）**:
客户资料中的内部业务提示。
_Avoid_: 客户备注、自动进入对外单据
_Authority_: [BOB 业务字段](docs/domains/bob.md#21-业务字段)

**Default Sales Order Remark（默认销售订单备注）**:
客户为新销售订单提供的默认备注。
_Avoid_: 客户内部提醒、订单保存后继续回查客户当前值
_Authority_: [VOU 编号、金额和引用](docs/domains/vou.md#21-编号金额和引用)

## Navigation

**APP Page Route（APP 页面路由）**:
APP 领域页面在菜单目录和前端路由中使用的稳定 `routeKey` 与 `routePath`。
_Avoid_: admin 领域、`admin/*` 管理页面路由、把页面路由等同于 API 动作路径
_Authority_: [APP 菜单模板](docs/domains/app.md#39-菜单模板)

## Configuration

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
一个会计账簿的 Approval-only 期初主体；它没有版本号，所有草稿、提交、批准和反批准都使用中央 `DRAFT`、`PENDING`、`APPROVED` 生命周期。
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
