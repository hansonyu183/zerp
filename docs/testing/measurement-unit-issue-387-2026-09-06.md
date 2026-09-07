# #387 计量单位修复验证

修复基线为 `f9b07aa5`，保留后续收款方式变更。原 `7db830d9` 的新建携带非法 description，编辑对不存在的 description 调用 trim；先通过公共 VM 测试分别复现，再迁入计量单位同目录 VM 和专有编辑器。输入直接使用 Hono 客户端推导函数，不保留跨实体强制转换；公共列表状态和启停后刷新继续复用。

## 验证记录

- `vitest run --config vitest.config.ts tests/unit/target/measurement-unit.vm.spec.ts`：修复前退出 1，两个保存回归均失败；修复后退出 0。新增边界、取消、未知结果不重放覆盖。
- 前端 `test:unit`：退出 0，最终 86 项普通测试、10 项 Vuetify 测试。`typecheck`、`lint`、`format:check`、`build:target` 均退出 0。
- 专用 `zerp-issue387-fix` Compose 使用回环端口 55440/18084/18085；启动前仅有原 zerp-back 共享环境。配置、构建、健康检查、目录同步均退出 0。凭证仅存在启动进程环境中。
- 真实 PostgreSQL `aux-management.int.test.ts`：退出 0，3 组查询分页、并发启停、审计和引用回归通过。
- 真实 PostgreSQL `archive-lifecycle.int.test.ts` 的 `all issue 364 aggregates`：退出 0，新增单位 current 改名、符号/精度变更并停用后，历史产品完整单位快照不变、新产品采用拒绝。
- 首次 `e2e -- measurement-unit.spec.ts user.spec.ts`：退出 1；用户/角色 5 项通过，计量单位桌面完成后在切换 390px 时与抽屉收起动画竞争。测试改为视口切换后重新加载并等待导航，再从菜单进入。

- 第二次浏览器复验在移动端点击当前菜单后抽屉仍展开，遮挡按钮，退出 1；测试显式收起抽屉后，最终 `e2e -- measurement-unit.spec.ts` 退出 0，1 项/16.7 秒。两个视口均从菜单完成创建、三字段搜索、编辑、启停，桌面创建 21 条后检索最后一条，移动端复用该集合并新增。
- 曾在 E2E fixture 中修改并停用单位，订单 payload 不变且后续流程执行通过；独立复审发现订单返回的 enteredUnit 仅有 objectId，无法以该断言证明名称、符号和精度保护。该不足的新增断言与 fixture 修改已撤回，不计入 B2-16 证据。浏览器页面测试结果不受此次测试辅助代码撤回影响。
- `pnpm --filter @zerp/api generate:artifacts` 退出 0，无生成物漂移；API `test:unit` 45 项、`test:artifacts` 20 项、`typecheck` 均退出 0。HTTP 契约补测 0/6、负数/7/非整数、空符号以及非法 description。
- `pnpm docs:check` 最初在记录文件尚未建立时退出 1；补齐后退出 0，6 项文档检查通过。`git diff --check` 退出 0。

接口与数据库结构没有变化，直接生成契约，不运行会重建默认环境的聚合命令。没有执行 CI、备份、生产部署、推送或合并。构建有单包超过 500 kB 的非阻断提示。

每轮专用 Compose `down --volumes --rmi local` 均退出 0，仅回收本任务创建的专用数据库、附件卷、网络及镜像，测试事实为可丢弃数据。原 zerp-back 共享服务继续运行；无需保留本任务临时服务。

## 复审结论与剩余边界

Standards：本片计量单位无剩余实质发现。Spec：两项页面保存错误已修复；B2-16 的产品快照已验证，但交易精度仍未闭环。现有 VOU enteredUnit 只返回 objectId，输入按固定六位小数校验，未使用所采用产品版本中的 quantityScale。补齐会改变 VOU 的交易提交规则及可能的展示契约，超出本次页面修复，需要独立跨领域切片确认；#387 不能据本次提交宣告全部完成。

复审提出的 Session 隔离疑虑经 ResourceHost 核对：实例 key 包含 session.generation，恢复会话会销毁旧 VM，dispose 同步停用公共列表并使旧响应失效；创建另有本片迟到响应测试。未为此修改公共层或添加第二套会话控制。
