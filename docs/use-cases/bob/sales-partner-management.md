# 销售合作方管理页面用例

## 范围

- 路由：`/bob/sales-partner`，由 `bob/sales-partner` Registry 资源以 `bob/sales-partner-management` 登记。
- 销售合作方的 current、Submission、能力、独立启停和业务归属规则以 [BOB](../../domains/bob.md#6-动作语义与约束) 为准；请求及响应以可执行 BOB 路由为准。

## `BOB-SALES-PARTNER-01` 查询与独立启停

1. 页面拥有正式资料 `query` 权限时加载 current 列表；关键词查询和分页使用已提交条件。
2. 列表展示编码、名称和对象启停状态。启用或停用只在拥有对应精确权限时执行，并以对象 revision 处理并发。
3. 服务端确认成功后刷新列表；冲突、blocker 与未知结果不触发本地重放或状态猜测。

## `BOB-SALES-PARTNER-02` 提交能力版本

1. 新增、克隆或变更只编辑临时 Submission 表单，包括身份资料、适用经营主体、默认经营主体和合作能力。
2. 提交前必须至少选择 `EXTERNAL_PART_TIME` 或 `CHANNEL_PARTNER` 一项；新增使用 `submit-new`，变更从 latest approved 版本提交 `submit-change`。
3. 成功提交后刷新 current 列表；候选在批准前不覆盖当前正式资料，表单失败时保留输入供用户修正。

## 验收

1. 启停是对象即时动作，不能由 Submission 生命周期替代，也不被审批动作覆盖。
2. 新外部兼职或渠道归属只采用当前启用、具有对应能力的销售合作方；既有归属保留精确 Approval Entry。
3. 页面不调用旧 DCL 销售合作方入口。

## 动态版本档案交互（#410）

本资源从强类型 definition 经 Registry/Resource Host 装配统一版本档案页；页面生命周期、明细/详情/附件/历史区块及公开验收边界采用 [ADR-0060](../../adr/0060-dynamic-page-runtime.md)。上述业务用例在此真实入口验收，桌面和 390px 均覆盖，取消、未知写入、资源/Session 切换与迟到请求沿用全站规则。
