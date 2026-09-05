# 产品申报页面用例

## 范围

- 路由：`/dcl/product`，由 `dcl/product` 登记。
- 产品行为模板、计量单位换算、包装规格和固定配方规则以 [DCL 产品申报](../../domains/dcl.md#34-产品申报) 与 [BOB 业务字段](../../domains/bob.md#21-业务字段) 为准。

## `DCL-PRODUCT-01` 查询与本地 Draft

1. 页面固定每页 20 个 product subject，一行分别呈现 latest approved 和唯一 open candidate。
2. 专属编辑器维护产品类型、分类、默认录入/计价单位、完整单位换算、包装规格和行为模板允许的固定配方；不使用任意 JSON 或通用技术字段编辑器。
3. 计量单位候选向用户显示 `symbol` 与 `quantityScale`；服务端采用与冻结规则直接遵循 [DCL 产品申报](../../domains/dcl.md#34-产品申报)。

## `DCL-PRODUCT-02` 固定配方克隆与提交

1. 从正式版本克隆时，配方原料按 stable product ID 前移到 latest approved Approval Entry，权威 `baseQuantity` 原样保留。
2. 被前移或无法解析的原料行保持明确待处理；用户逐行确认后才可提交，页面不得静默采用或删除。
3. submit/approve 的服务端校验和失败语义直接遵循 [DCL 产品申报](../../domains/dcl.md#34-产品申报)；页面只呈现服务端返回的稳定错误。

## 验收

1. Product 页面不恢复服务器 DRAFT、通用 JSON 编辑、手输 Approval Entry 或 BOB direct CRUD。
2. PostgreSQL/HTTP 回读证明单位换算、固定配方和原料精确版本完整保存，伪造的 AUX 展示字段被服务端事实覆盖。
