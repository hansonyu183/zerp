# DCL 经营主体变更页面用例

权威业务规则见 [DCL 经营主体申报](../../domains/dcl.md)、[BOB 领域职责](../../domains/bob.md#2-领域职责与边界)与 [Approval Version](../../domains/approval.md#6-approval-version)，线协议见 [OpenAPI DCL Schema](../../../contracts/openapi/schemas/dcl.yaml)。

## 1. 页面与列表

1. 页面入口为 `/dcl/operating-entity`，使用独立 DCL 菜单项和 ViewModel；APP 工作台、审批待办与审批记录中的经营主体深链都进入该页面。
2. 列表调用 `POST /dcl/operating-entity/query`，同时展示 latest approved 与唯一开放候选；已知审批状态使用共享中文映射。
3. 新建、编辑、启停、提交、撤回、驳回、批准、反批、删除、版本和审计动作分别检查对应 `/dcl/operating-entity/*` 精确权限。页面不调用 BOB 写路径，也不借用 BOB ViewModel 路由跨域请求。

## 2. 新建与编辑

1. 新建只填写法定名称，以及可选简称、税号、地址、电话和备注；编码由服务端分配，初始 `enabled=true`。
2. V1 草稿可保存、提交或删除；批准前不会出现在 BOB 只读列表或交易候选中。删除草稿会删除 subject，但已经分配的编码永久跳过。
3. 编辑 latest approved 时，页面提交完整 DCL 快照并创建唯一候选；候选待审期间 BOB 继续读取旧正式版本。
4. 启用或停用生成带目标 `enabled` 的新候选，不触发 BOB 写入。页面明确提示“已生成草稿”，由用户继续正常审批。

## 3. 审批与回落

1. V1 批准后经营主体才进入 BOB 只读资料和交易候选；V2 批准后 BOB 查询自然读取 V2，无额外 current 写入。
2. 反批 V2 后重新读取并显示 V1 为当前正式版本；反批 V1 后保留 subject、编码和历史，但 BOB 查询不再返回该主体。
3. 只允许反批最新正式版本。存在开放候选、精确历史引用 blocker、revision 过期或提交人自审时，页面按稳定 `errorKey` 展示业务提示，不按 message 文本分支。

## 4. 历史与异常

1. 版本历史调用 DCL `versions`，审计调用 DCL `audit-history`；历史版本只读且不被当前资料改写。
2. 任一写请求失败后重新读取详情；服务端保证 Approval entry、事件和 DCL 快照不会部分成功。

## 5. 服务端动作与刷新

列表项和详情根级 `availableApprovalActions` 是生命周期按钮的唯一依据，并与经营主体业务动作共同组成页面 ViewModel；页面不自行推导动作。任何业务或生命周期动作完成后刷新受影响的 `query` 与已打开对象的 `get`；失败或 revision 冲突不自动重放，仍由执行接口检查并返回 blocker。3. 关键词、状态、启用状态、分页与排序始终由 DCL query 明确提交；移动端卡片与桌面表格使用同一个 DCL ViewModel 和动作规则。4. 自动化验收必须证明全部生命周期请求只发送到 DCL，并证明 BOB 独立入口没有这些动作。
