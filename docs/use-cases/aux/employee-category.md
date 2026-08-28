# 人员类别维护

## 页面职责

1. 页面入口为 `/aux/employee-category`，用于维护员工申报所需的人员类别资料。
2. 页面遵循 [AUX 领域规则](../../domains/aux.md)，只通过 OpenAPI 定义的 `/aux/employee-category/*` 接口完成查询、保存与审批生命周期。
3. 字段仅包含 `name` 与 `description`；页面不预置类别、不推断旧 `category` 数据，也不维护员工本身。

## 编排与异常

1. 列表和详情展示中央审批状态；新建、保存、提交、撤回、批准、驳回、反批和删除均使用返回的 `approvalEntryId` 与 `approvalRevision`。
2. 引用阻断遵循 [AUX 领域规则](../../domains/aux.md)；页面展示后端返回的结构化 blocker，不自动迁移或替换类别。
3. 已知状态和错误按共享中文映射展示，`message` 只作为默认诊断说明。

## 验收场景

1. 新建人员类别后可以保存并完成审批，获批项能够出现在 DCL 员工页面的人员类别选择器中。
2. 被员工候选使用的人员类别执行受限操作时，页面展示结构化 blocker，原数据保持不变。
3. 页面请求路径中不出现通用 `category` 或 BOB Employee 写接口。
