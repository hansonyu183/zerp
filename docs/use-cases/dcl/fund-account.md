# DCL 资金账户变更页面用例

权威业务规则见 [DCL 资金账户申报](../../domains/dcl.md#33-资金账户申报)、[BOB 对象与引用规则](../../domains/bob.md#2-领域职责与边界) 与 [Approval Version](../../domains/approval.md#6-approval-version)，线协议见 [OpenAPI DCL Schema](../../../contracts/openapi/schemas/dcl.yaml)。

## 1. 页面与列表

1. 页面入口为 `/dcl/fund-account`；它是资金账户唯一维护入口。工作台、审批待办和审批记录中的资金账户深链都进入该页面。
2. 列表调用 `POST /dcl/fund-account/query`，展示最新已批准版本和唯一开放候选。新建、保存、启停、提交、撤回、驳回、批准、反批准、删除、版本及审计分别检查精确 `/dcl/fund-account/*` 权限。
3. 页面不调用 BOB 写路径；`/bob/fund-account` 仅显示当前正式档案。

## 2. 新建、编辑与启停申请

1. 新建或保存提交完整资金账户快照：名称、币种、经营主体、户名、银行、支行、账号、备注与 `enabled`；编码由服务端生成。
2. 经营主体只选择当前可用的 BOB 只读候选。页面不接受 Approval Entry 手工输入；后端在创建/保存时快照 latest approved，提交/批准时校验来源未漂移。
3. 账号输入移除空白和连字符并转为大写；页面以服务端规范化结果为准。非空账号冲突返回稳定 `fund_account_identifier_conflict`，不自动改号、迁移或清空。
4. 启用或停用都通过 `POST /dcl/fund-account/save` 建立完整候选，不触发 BOB 写入。

## 3. 审批、引用阻断与历史

1. V1 批准后资金账户进入 BOB 只读资料并可供 VOU/ACC 选择；后续版本批准后 BOB typed query 自然读取新版本。反批准最新正式版本后回落到上一正式版本；反批准首版后 BOB 查询不再返回资金账户。
2. 正式或开放候选占用的账号不能被其他资金账户复用；批准新版本释放旧账号。如反批准会回落到已被复用的旧账号，反批准被原子拒绝。
3. 任一已持久化 VOU 正文精确引用该 Approval Entry 时反批准返回 `bob_unapprove_blocked`；失败不改变 Approval、占用、VOU 快照或由该 VOU 派生的 ACC 事实。
4. `versions` 与 `audit-history` 只读展示服务端历史；revision 冲突、自审、非最新版本、账号冲突、经营主体来源漂移和引用 blocker 均按稳定 `errorKey` 提示。

## 4. 验收场景

1. 全部资金账户生命周期请求均发送到 `/dcl/fund-account/*`，BOB 当前入口没有任何写或审批动作。
2. V1/V2 批准和反批准后，BOB typed query 不经额外写入即可显示、切换、回落或隐藏；失败时 DCL snapshot、Approval 与账号占用全部回滚。
3. 经营主体来源漂移、账号并发唯一、回落冲突及 VOU blocker 由真实 PostgreSQL 测试覆盖。
4. 历史 VOU 在资金账户后续改版、改币种或改所属主体后，仍保留原 stable ID、Approval Entry ID 与快照；ACC 仍通过不可变 VOU `source_id` 追溯该版本。

## 5. 服务端动作与刷新

列表项和详情根级 `availableApprovalActions` 是生命周期按钮的唯一依据，并与资金账户业务动作共同组成页面 ViewModel；页面不自行推导动作。任何业务或生命周期动作完成后刷新受影响的 `query` 与已打开对象的 `get`；失败或 revision 冲突不自动重放，仍由执行接口检查并返回 blocker。
