# 流程定义管理

## 页面目标

流程管理员通过 `/wfl/process-definition/*` 管理唯一的 Starlark 定义来源。业务规则见 [WFL 领域文档](../../domains/wfl.md)，HTTP 线协议见 [OpenAPI](../../../contracts/openapi/openapi.yaml)。

## 主流程

1. 页面查询并读取定义，展示草稿脚本、结构化诊断和只读编译图。
2. 管理员保存时提交 `definitionId`、当前 `revision` 和完整脚本；冲突时刷新定义再处理。
3. 管理员输入一个已存在 VOU 单据的 entity 和 documentId 试算。页面展示命中轨迹、计划动作和未覆盖分支，不搜索或展示 VOU 正文。
4. 当前草稿 revision 试算成功后可以发布；发布返回 `publishedRevision`。管理员再使用返回的新 `revision` 启用定义。
5. 停用只阻止未来根匹配；已发布修订和已有实例仍可读取与运行。

## 异常分支

- 编译失败：保存脚本和诊断，继续显示上一次成功编译图，禁止试算和发布。
- 试算对象不存在或类型与根节点不同：显示业务错误，不记录成功证明。
- revision 冲突：不覆盖服务端草稿。
- 未发布定义启用、未试算草稿发布：服务端拒绝。
