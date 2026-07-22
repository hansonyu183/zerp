# 项目关键约束

- 技术栈为 Vue 3、TypeScript、Vite、Vuetify 和 Pinia；使用 pnpm，Node.js 版本须为 20.19 或更高。
- 页面组件负责模板、样式和交互装配；业务状态与动作放在同目录的 `vm.ts`。仅跨页面共享且需要保持一致的状态进入 Pinia。
- 所有业务 API 统一通过 `src/api/client.ts` 调用真实后端，路径遵循 `POST /{domain}/{entity}/{action}`。业务代码不得直接调用 `fetch`，不得使用假数据或本地数据作为失败兜底。
- 认证与权限使用 `app` 领域标识，不使用 `auth`。实现领域功能前先阅读对应领域文档：[APP](docs/domains/app.md)、[BOB](docs/domains/bob.md)。
- Cookie 会话和 CSRF 统一由 API 客户端处理。不得提交或记录密码、密钥、Cookie、Token、测试账号及敏感业务数据。
- 后端菜单只能映射到本地已注册页面。前端权限仅用于菜单、按钮和交互控制，后端鉴权才是最终安全边界。
- Vitest 单元及组件测试可使用 MSW；Playwright 核心流程必须连接真实测试后端，不得拦截或模拟业务请求。
- 修改后至少运行相关单元测试；提交前运行 `pnpm build`。关键业务流程变更必须补充对应测试。
- 保留用户已有的未提交修改，只改动任务相关文件。详细规范以 `README.md` 为准。
