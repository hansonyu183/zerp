# 会计映射一次性迁入 ACC

在完成 BOB 客户转换后的基线上执行 `pnpm --filter @zerp/api migrate:acc-mapping`。命令从受控环境读取 `TARGET_DATABASE_URL` 和数据库范围；使用现有 `zerp` 数据库时明确设置 `TARGET_DATABASE_SCOPE=production`。该名称只是数据库边界配置，不表示执行生产发布。

迁移在一个事务内锁定旧映射与授权相关表，校验身份、历史和未决候选，然后创建 ACC 当前配置及引用，将旧映射和精确消费事实转为只读历史证据，移除旧科目/账簿目录副本并转换精确读取授权。稳定主体 ID、原 Approval、事件和旧记账事实保持不变。只有开放 V1 时保留其内容但不改变原审批状态；正式内容同时存在未决候选时返回带 subjectId 的 blocker，由正常业务流程显式处理后重新执行。

`save` 是新能力，旧 submit/review 角色不会自动获得它；按 APP 正常授权流程分配。新运行路径仅使用当前配置，不保留 DCL 维护或历史回退。目标表已存在或旧源缺失时拒绝再次执行。事务内任一步骤失败都会回滚结构、数据和权限，无部分转换。

完成后分项运行 `generate:artifacts`、`generate:db`、相关 typecheck、映射 HTTP/事务测试和浏览器验证。不调用带数据库重建的聚合命令，不部署或重启共享服务。
