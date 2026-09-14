# DCL 资料变更领域

## 1. 所有权

DCL 使用固定标识 `dcl`，拥有 Customer、Product、Supplier、Other Unit、Sales Partner 的 stable identity、业务编码及类型化版本内容。中文名称为“资料变更”；BOB 中文名称为“正式资料”。五类实体 wire value 保持 `customer`、`product`、`supplier`、`other-unit`、`sales-partner`，中文名称复用共享档案映射。

公共 [Approval](approval.md) 持有版本头、状态、Submission revision、版本选择和审批审计；[BOB](bob.md) 持有独立即时启停和正式／历史读取。类型化业务字段及采用规则见 BOB 的对应实体规则，DCL 在其外层事务中执行这些不变量。客户是单层对象；客户与供应商引用 AUX 税务信息。AUX、ACC、RPT、WFL 的维护归属不变。

## 2. 唯一维护边界

临时输入仅在当前页面保留，关闭、刷新或切换账号销毁。新增、克隆生成新稳定身份；变更明确采用正式版本 ID 和 revision。submit-new/submit-change 原子创建不可变 Submission，每个对象最多一份开放提交件。待批期间旧正式版继续可用，批准后采用新版，反批准可回落，但均不改写 BOB enabled/object revision。

审批动作、职责分离、结构化 blocker、拒绝／撤拒与删除开放提交件遵循 Approval 规则。不增加正式对象删除。客户新建和变更按对应提交权限维护完整客户业务属性及税务关联。提交、审批及独立启停使用一致的对象锁顺序，失败整笔回滚。

## 3. 精确授权与附件

五类提交件查询、详情、提交、审批、开放删除、提交附件读取及暂存／清理只走 DCL 精确权限。BOB 的正式读取、versions、历史详情和启停授权独立；历史详情复用 versions 权限，不能由提交或审批推导。DCL 不提供对象版本历史入口；修改基线从 BOB 正式对象取得。

客户附件在提交时暂存并随 Submission 原子采用，历史存储键不变。DCL 读取校验实体、主体、提交件及附件归属；BOB 正式与历史附件分别按 get 与 versions 授权读取真实采用快照，不要求 DCL 权限。开放删除及过期暂存的物理清理沿用事务删除任务。

HTTP 契约只由可执行 Hono/Zod 路由生成。迁移保持身份、审批、附件和精确业务引用，按原精确能力转换权限，不扩大普通角色授权；见 [ADR-0062](../adr/0062-dcl-maintenance-bob-formal-history.md)。

## 客户与供应商税务关联

客户为单层对象，提交完整业务属性及税务关联集合，遵循 [BOB 客户规则](bob.md#34-单层客户与税务关联)。供应商同样移除独立法定身份与重复开票字段，保留采购属性。关联不重复、不设默认项，新关联采用启用 AUX 税务信息并保留当时快照；关联集合变更随 Submission 审批，AUX 字段更新不改写任何历史版本。其他单位和销售合作方的身份规则不变。
