# 开发说明

## 环境与目录

NEXT 使用 JavaScript ES Modules，要求 Node.js **22+**。目标宿主是 Windows 上的 **DeepSeek Harness 0.2.1-alpha.5**；宿主相关 peer dependencies 由兼容 Harness 提供。浏览器界面通过原生 ModuleLoader 加载，不修改宿主安装文件。

- `lib/`：服务、状态投影、验证、去重、计量和构建后的客户端入口。
- `src/client.js`：设置、开关与用量界面源码。
- `tests/`：无付费单元与契约回归。
- `scripts/`：构建、静态检查、隔离原生验证与评测工具。
- `cordis.patch.yml`：插件 bundle 声明。

## 构建与打包

```powershell
npm install
npm run build
npm test
npm run check
npm pack
```

`build` 同步客户端入口；`test` 运行无付费测试；`check` 检查语法与 manifest；`pack` 的预打包步骤会重新构建并检查。包名保留为 `@local/dsh-next`，GitHub 开源不等于已发布到 npm。

上述测试不调用模型。测试通过说明对应契约成立，不等于真实宿主、界面或效果验收完成。当前限制见 [验证记录](VALIDATION.md)。

## 原生宿主与界面验证

原生 smoke 脚本需要本机安装兼容 Harness、可解析的宿主模块及隔离 profile。请先阅读脚本参数和输出路径，使用测试目录，避免直接套用他人的机器路径或生产配置。`run-native-smoke.mjs` 提供生产能力、自动化、并行、开关和模型策略等场景；可运行性依赖实际宿主环境。

界面回归由 `check-responsive.mjs` 驱动，需具备浏览器测试运行时。分别检查窄屏、桌面、中文、英文、放大文本、异步失败与重试。截图和模拟 RPC 只证明相应界面场景；安装验收仍需检查宿主远程调用、设置保存和插件重载。

可通过环境变量适配辅助脚本的本机依赖：

| 变量 | 用途 | 默认 |
| --- | --- | --- |
| `NEXT_EVAL_PNPM_STORE` | 评测依赖所在的 pnpm store 目录 | 仓库下 `node_modules/.pnpm` |
| `NEXT_PLAYWRIGHT_PATH` | Playwright 包目录 | `node_modules/playwright` |
| `NEXT_ADAPTIVE_PACKAGE` | 可选的 Adaptive 原生兼容测试 fixture | 当前用户 `.dsh/profiles/desktop` 中的 Adaptive 包；仅传入 `--adaptive` 时使用，未传时不启用 fixture |

不要提交生产 profile、登录信息、私有会话、输出中的个人内容或本地费用账本。凭据不能放入命令行参数、日志或报告。

## 检查类型与执行约束

配置统一经过 `normalizeVerificationChecks`。现有 `json-syntax`、`json-schema` 保持兼容；`command` 需要准确命令、工作目录、超时与脚本／锁文件绑定；`artifact` 支持 `csv`、`json`、`markdown`。

通过设置页扫描生成命令登记，避免手工猜测摘要。绑定使用原生读取规范化后的文本，不能直接用文件原始字节摘要替代。执行必须走宿主原生工具、当前权限和取消链，不能绕过授权运行子进程。

脚本或锁文件变化使登记过期，重新确认后才能运行。命令结果不跨任务缓存；输入无法完整观察、命令仍在后台、超时或取消时不能记为通过。文件结构通过与业务内容正确要分别报告。

## 能力、策略与费用

`nextCapabilities` 是设置页与状态命令的共享投影，展示能力可用性和原因。模型调用前的可见性检查不能替代执行时重新检查。

偏好解析顺序为默认、标签、模型覆盖。DeepSeek 官方账号与 API 共享策略时，仍须保持路由各自的价格与费用记录。所有优化与自动工作受会话 NEXT 开关控制，不得增加额外分类、规划或续行循环。

计量变更需保留流式去重、完整用量结算、未知费用与预留的语义。历史结算不能因修改价格而重算。

## 真实付费评测

`production-frontend-eval*.mjs` 等脚本是受控评测工具，**不属于 `npm test`**。运行前必须明确获得付费授权，准备自己的隔离目录、有效价格、预算账本、旧请求状态检查与费用预留策略。没有这些条件时只运行无付费准备和预检。

评测凭据通过本机宿主 provider 读取，仓库不附带账号、密钥或私人配置。不得将他人的账本金额当作自己的余额，也不得删除未知预留来恢复派发。任何新未知费用应暂停付费评测。

对照必须锁定协议和评分，并将原始交付与返工分开。两组首次交付不允许外部补代码后再评分。模型别名、价格时效、采样差异和单次样本的局限必须保留在报告中。

## 安装回退

生产安装前备份目标 profile 配置、依赖 manifest、锁文件与旧插件包。在隔离宿主和真实界面检查后，再用配套 `dsh plugin` 命令安装。

回退时等待活动调用结束，卸载新包并安装保留的兼容旧包。仅回退 NEXT 新增配置，保留之后发生的会话、其他插件与设置变更。不要删除共享 `.dsh` 或整目录覆盖 profile。

## 许可证

项目按 [MIT](../LICENSE) 许可开源。DeepSeek Harness、第三方依赖及模型服务各自遵循其许可证与服务条款；本项目不代表官方支持或合作关系。依赖说明见 [第三方声明](../THIRD_PARTY_NOTICES.md)。
