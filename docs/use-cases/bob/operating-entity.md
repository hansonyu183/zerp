# 经营主体页面用例

权威业务规则见 [BOB 领域](../../domains/bob.md)、[DCL 经营主体申报](../../domains/dcl.md) 与 [Approval Version](../../domains/approval.md#6-approval-version)，线协议见 [OpenAPI DCL Schema](../../../contracts/openapi/schemas/dcl.yaml) 和 [OpenAPI BOB Schema](../../../contracts/openapi/schemas/bob.yaml)。

## 1. 页面与列表

1. 页面入口保持 `/bob/operating-entity`，导航和当前正式引用仍属于 BOB 业务视图。
2. 页面候选列表调用 `POST /dcl/operating-entity/query`，同时展示 latest approved 与唯一开放候选；已知审批状态必须显示共享中文映射。
3. 新建、编辑、启停、提交、撤回、驳回、批准、反批、删除、版本和审计动作分别检查对应 `/dcl/operating-entity/*` 精确权限。页面不得调用旧 BOB 写路径。

## 2. 新建与编辑

1. 新建只填写法定名称，以及可选简称、税号、地址、电话和备注；编码由服务端分配，初始 `enabled=true`。
2. V1 草稿可保存、提交或删除；批准前不会出现在 BOB 当前列表或交易候选中。
3. 编辑 latest approved 时，页面提交完整 DCL 快照并创建唯一候选；候选待审期间当前 BOB 资料继续显示旧正式版本。
4. 启用或停用生成带目标 `enabled` 的新候选，不能直接修改 BOB 当前行。页面明确提示“已生成草稿”，由用户继续正常审批。

## 3. 审批与回落

1. V1 批准后经营主体才进入 BOB 当前读取和交易候选；V2 批准后当前资料一次切换到 V2。
2. 反批 V2 后页面重新读取并显示 V1 为当前正式版本；反批 V1 后保留对象、编码和历史，但 BOB 当前读取不存在。
3. 只允许反批最新正式版本。存在开放候选、精确历史引用 blocker、revision 过期或提交人自审时，页面按稳定 `errorKey` 展示业务提示，不按 message 文本分支。

## 4. 历史与异常

1. 版本历史调用 DCL `versions`，审计调用 DCL `audit-history`；历史版本只读且不被当前资料改写。
2. 任一写请求失败后重新读取详情；服务端保证 Approval entry、事件、DCL 快照和 BOB 当前投影不会部分成功。
3. 关键词、状态、启用状态、分页与排序始终由 DCL query 明确提交；移动端卡片与桌面表格使用同一 ViewModel 和动作规则。
