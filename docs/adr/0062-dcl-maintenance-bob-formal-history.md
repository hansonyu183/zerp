---
id: ADR-0062
date: 2026-09-14
status: accepted
partially_superseded_by: ADR-0063
partially_supersedes: ADR-0055
---

# DCL 维护资料，BOB 提供正式资料与对象历史

为表达资料变更与业务采用的不同工作边界，客户、产品、供应商、其他单位、销售合作方的稳定身份、编码、类型化内容和提交审批归 DCL；BOB 只持有独立 enabled/object revision，直接读取 DCL 最高已批准版本和精确历史快照。公共 Approval/Version 保持版本头、状态、revision、唯一开放提交件、职责分离及审计的唯一所有权。

此决定替代 ADR-0055 中五类档案由 BOB 同时读写及持有身份与内容的条款。其独立启停、历史事实连续性、不可变 Submission、客户子单位和类型化业务规则继续有效；AUX、ACC、RPT、WFL 归属不变。本片不改变客户子单位或税务模型。

DCL 提供提交件查询与详情、submit-new/submit-change、审批、开放提交件 delete 及附件写入。修改须明确正式版本基线。BOB 保留 query/get/options、enable/disable、versions 和对象历史详情；版本列表及历史详情只读，按 entity、subject 和 Approval Entry 校验归属，不要求 DCL 审批权限。未批准历史不能作为正式资料采用。正式及历史附件按 BOB 授权，提交件附件按 DCL 授权。DCL 页面不提供对象历史入口，BOB 页面不提供业务内容维护或审批。

一次切换精确迁移维护及审批权限、工作台和附件授权，保留 BOB 正式读取、历史和启停权限，不从旧能力推导更宽权限。客户 save-subunits 等价迁入 DCL。稳定 ID、编码、Entry ID、版本、内容、附件、精确引用和启停事实不变；迁移前冻结写入并备份，转换原子提交，失败恢复匹配的应用及数据。旧 BOB 写入路径删除。

对应 [#438](https://github.com/hansonyu183/zerp/issues/438)，父规格 [#437](https://github.com/hansonyu183/zerp/issues/437)。
