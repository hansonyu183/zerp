# #388 收款方式审查修复

基线 `4116e58a`；修复 `f9b07aa5` 的收款方式跨实体编辑器适配及缺失验收。收款方式由同目录 VM 和专有编辑器持有强类型字段，直接调用 Hono 推导客户端；删除 simple VM 的金额分支、可选字段、强制转换和专有表单控件。公共列表状态仍由既有 ListPage VM 持有。页面用例补齐领域/路由引用、编排和异常分支。

## 验证

- 前端 `typecheck`、`lint`、`format:check`、`build:target` 均退出 0；构建有现有 500 kB 分包提示。
- 前端 `test:unit` 退出 0：96 项普通测试、10 项 Vuetify 测试；随后新增迟到创建、冲突和未知结果测试，聚焦 `vitest run --config vitest.config.ts tests/unit/target/payment-method.vm.spec.ts` 13 项通过，退出 0。覆盖默认金额、非法格式、超出安全整数范围的金额字符串、编辑回填与字符串 revision、取消及响应隔离。
- API `typecheck`、`test:unit`（45 项）、`test:artifacts`（20 项）、`generate:artifacts` 均退出 0，无生成物变化；未修改 SQL 或运行数据库生成。
- `pnpm docs:check` 退出 0，文档检查及 6 项回归通过；`git diff --check` 退出 0。
- 专用 `zerp-issue388-fix` Compose 使用 55441/18086/18087 回环端口。初次目录同步因 scope 错填 test 退出 1并完成资源回收；改为实际支持的 isolated 后配置、目录同步、构建、启动与健康检查均退出 0。凭证只存在进程环境。
- 真实 PostgreSQL `aux-management.int.test.ts` 退出 0，3 组查询、并发/审计及引用回归通过。
- 真实 PostgreSQL `archive-lifecycle.int.test.ts` 的 `all issue 364 aggregates` 退出 0。新增 AUX 收款方式改名、加价从 0.05 改为 0.06 并停用后，完整客户旧快照不变、新采用被拒绝；通过 ArchiveService 公开读取观察历史。
- 首轮 `pnpm --filter @zerp/api e2e -- payment-method.spec.ts user.spec.ts` 退出 1：用户/角色 5 项通过；收款方式测试把现有成功提示写错。修正断言后，`e2e -- payment-method.spec.ts` 退出 0，1 项/20.3 秒。
- 最终浏览器测试包含真实 Hono/PostgreSQL HTTP 大额定点字符串持久化、5 种非法金额保存拒绝及完整详情无部分变化；桌面/390px 从菜单搜索名称/拼音/编码、创建、编辑、启停，桌面创建超过一页数据。取消和非法输入保留原金额；冲突响应通过浏览器拦截注入以验证中文反馈；真实保存成功后中断查询以验证成功但刷新失败提示。并发持久化保证由上述真实 PostgreSQL 测试覆盖。

## 复核与范围

Standards：收款方式专有状态已归属同目录，无跨实体强制转换或字段分派；simple 表单只保留人员类别/岗位共享字段。本次三项审查意见均已处理。

Spec：新增页面接线、金额传递、失败反馈及客户历史快照有实际证据。销售单据的历史付款快照与显式重新选择采用新值未在本次新增端到端证明，不据此宣告整个 #388/B2-17 完成。

各轮专用 Compose 均执行 `down --volumes --rmi local`，删除本任务可丢弃数据库容器、附件卷、网络及镜像。原 zerp-back 共享环境保持运行。未执行 CI、备份、生产发布、推送或合并。
