# DCL 主体申报页面用例

权威业务规则见 [DCL 主体申报](../../domains/dcl.md#35-主体申报)、[BOB Party 与关系](../../domains/bob.md#2-领域职责与边界) 和 [Approval Version](../../domains/approval.md#6-approval-version)，线协议见 [OpenAPI DCL Schema](../../../contracts/openapi/schemas/dcl.yaml)。

## 页面与权限边界

1. `/dcl/party` 是共享身份的候选、影响预览、保存、提交、撤回、驳回、批准、反批、版本、审计和合并维护入口；待办深链进入本页。
2. 页面没有“新建主体”操作。新 Party 只能由首条强类型关系创建；关系创建失败时 DCL stable root、candidate 与 typed relationship root 均不落库。
3. 保存总是提交完整身份 snapshot：类型、法定名称、显示名称、强标识、税号和通用联系资料。影响预览只显示当前用户可读的关系，不泄露隐藏关系。
4. 强标识在 latest approved 与唯一 open candidate 之间共同占用。首条关系提交的新身份精确命中可读 approved Party 时复用既有 Party，命中不可读 Party 或仅命中未批准候选时返回不泄露资料的占用冲突；提交和批准分别重新校验占用，冲突或 Approval revision 冲突不改变候选和既有正式资料。
5. V1 与首条关系不可拆分，因此页面不提供 V1 草稿删除；已有正式版本时，后续 `DRAFT` candidate 可以删除并释放其候选强标识。

## 当前投影、合并与验收

1. V1 批准前 BOB 不可见；批准后直接读取 latest approved。V2 批准时自然切换，反批 latest 时自然回落，反批 V1 时自然不可见。
2. 合并必须在本页先预检：请求提交双方 latest approved `sourceApprovalEntryId` 与 Approval revision，双方存在正式版本且不存在 Party candidate 才能继续。用户显式处理全部关系冲突后，以 `preflightId` 和选择结果确认；资料、Approval token 或关系变化都会使预检失效。来源 DCL Party root 标记 merged-into 后从 BOB 查询消失，DCL history/claims、merge audit 和历史单据不改写。
3. BOB `/bob/party` 只读取当前身份和按权限裁剪的关系卡片，不展示编辑、审批、版本、审计或合并写动作。
4. 真实 PostgreSQL 覆盖原子首条关系创建、V1/V2 可见性与自然回落、强标识并发占用、权限隔离、影响预览不泄露及合并事务回滚。
