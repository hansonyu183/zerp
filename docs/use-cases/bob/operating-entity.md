# BOB 经营主体当前有效资料页面用例

权威业务规则见 [BOB 领域](../../domains/bob.md)与 [DCL 经营主体申报](../../domains/dcl.md)，线协议见 [OpenAPI BOB Schema](../../../contracts/openapi/schemas/bob.yaml)。

## 1. 页面与列表

1. 页面入口为 `/bob/operating-entity`，使用独立 BOB 菜单项和 ViewModel，只按 BOB `query/get` 精确权限出现与读取。
2. 列表调用 `POST /bob/operating-entity/query`，只展示已经批准的当前正式档案；详情调用 `POST /bob/operating-entity/get` 重新读取 DCL highest APPROVED typed snapshot。
3. 页面不展示候选、审批状态、创建、编辑、启停、提交、撤回、驳回、批准、反批、删除、版本或审计控件，也不调用任何 `/dcl/operating-entity/*` 或 BOB 写接口。

## 2. 当前有效资料

1. 列表和详情展示稳定 ID、业务编码、来源 Approval Entry ID、法定名称、简称、税号、地址、电话、备注与当前启用状态；不把审批候选字段拼入当前有效资料。
2. DCL 存在草稿或待审候选时，本页面继续显示旧正式档案；候选批准后，下一次查询或详情读取自然选择新批准版本。
3. 具有 DCL 查询权限时，可以提供“查看申报”导航，目标为 `/dcl/operating-entity?objectId=<stable-id>&mode=view`；导航不是 BOB 内写入口，也不得复用 BOB ViewModel 执行 DCL 请求。

## 3. 正式资料变化

1. V1 批准前列表和详情均不可见；V1 批准后出现。V2 草稿或待审期间继续显示 V1，V2 批准后一次切换到 V2。
2. DCL 反批 V2 后，下一次读取显示回落的 V1；反批 V1 后列表不再返回该主体，直接打开旧深链时按稳定未找到错误处理。
3. BOB 页面只观察 highest-approved 读取结果，不发起或模拟任何审批动作。

## 4. 异常与验收

1. 关键词、启用状态、分页与排序始终由 BOB query 明确提交；移动端卡片与桌面表格使用同一个只读 BOB ViewModel。
2. 没有已批准版本或读取失败时展示稳定错误状态，不回退调用 DCL candidate 补齐资料。
3. 自动化验收必须证明 BOB 页面网络请求只有 BOB `query/get`，且 DOM 中不存在 lifecycle 控件。
