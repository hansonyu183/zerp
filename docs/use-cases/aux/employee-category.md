# 人员类别维护

## 页面职责

1. 页面入口为 `/aux/employee-category`，用于维护员工申报所需的人员类别资料。
2. 页面遵循 [AUX 领域规则](../../domains/aux.md)，只通过 OpenAPI 定义的 `/aux/employee-category/*` 接口完成查询与 direct CRUD。
3. 字段仅包含 `name` 与 `description`；页面不预置类别、不推断旧 `category` 数据，也不维护员工本身。

## 编排与异常

1. 列表展示 current data 和启停状态；新建立即生效，保存、启停与删除使用 `objectRevision` 防止并发覆盖。
2. 引用阻断遵循 [AUX 领域规则](../../domains/aux.md)；页面展示后端返回的结构化 blocker，不自动迁移或替换类别。
3. 已知状态和错误按共享中文映射展示，`message` 只作为默认诊断说明。

## 验收场景

1. 新建人员类别后立即出现在 DCL 员工页面的人员类别选择器中；改名直接生效，但不改写已保存的员工 snapshot。
2. 被任一员工版本使用的人员类别仍可停用，但删除时页面展示结构化 blocker，原数据保持不变。
3. 页面请求路径中不出现通用 `category` 或 BOB Employee 写接口。
