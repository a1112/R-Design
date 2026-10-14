# R-Design

现有 React 前端可通过 [工程生成与预检工具](docs/engineering-bundles.md) 制作完整便携工程；支持范围、配置样例和运行验收要求见该文档。

面向桌面与 iPad 的实时 UI 设计工作台。真实运行实例提供画面与结构，源码提供长期实现，批注表达设计意图，候选变更保存代码与验证证据。

本仓库依据 [完整设计方案 v1.0](docs/specs/design-v1.0.pdf) 从空仓库实现。当前可用主线是受控 React + TypeScript + Vite 项目的真实画面、控件选择、原始笔迹、精确属性修改、隔离候选、桌面/窄屏验证、审查接受与保护后续编辑的回退。平台和功能验证状态见 [验收矩阵](docs/specs/acceptance-matrix.md)。设计中的 30 fps / P95 指标仍是待测目标，当前传输使用低帧率无损 PNG + WebSocket。

## 运行

需要 Node.js 22.13+（推荐 24）及可用的 Chromium。PDF6 预览依赖声明 `>=22.13.0 || >=24`。首次安装：

```sh
npm install
npx playwright install chromium
npm run dev
```

打开 **http://127.0.0.1:4310** 进入工程主页，可新建、搜索、收藏、归档或导入工程。每个工程保存自己的源码、画板、批注、资产和变更历史；打开工程后进入无限画布编辑器。Bridge 保持一个活跃的受控运行实例，获准的设备观察同一表面。独立预览地址 http://127.0.0.1:4311 会创建另一页面，不能当作工作台跟随的实例。

可先打开现有设备监控工程，试一次完整修改：

1. 点击左侧「图层」，选择 `start-button`，或在设计模式点击运行画面的「开始监控」按钮。
2. 把文字改为「立即开始」，圆角改为 `12`，点击「准备修改」。
3. 检查修改理解卡，确认生成隔离候选。
4. 在「任务」运行验证，查看源码差异、真实候选截图及交互证据。
5. 验证通过后接受。真实实例重载并回传新画面；需要时回退该变更。

内容区使用可平移、缩放的无限画布，画板保持源尺寸；鼠标中键、空格拖动或 `H` 手形工具平移，`V` 回到选择，Ctrl/⌘ + 滚轮或双指捏合围绕光标/双指中心缩放，`Shift+1` 适合全部画板、`Shift+0` 回到 100%。画布缩放不会改变目标程序的视口；顶部「桌面 / 窄屏」按钮才会调整源视口。

「交互」会取得短期输入租约；「批注」冻结观看帧并在本机绘制，不会点击业务按钮。保存笔迹和文字只创建评论。文字意见必须经过理解确认才会变成任务。离线批注先持久化，恢复连接时重放同一操作身份；旧对象失联时保留快照意见。

## 工程结构

- `apps/workbench-web`：响应式工作台、画板、属性、批注、资产、候选差异和配对。
- `apps/bridge`：鉴权、项目授权、运行实例、实时画面、输入租约和统一 API。
- `apps/ipad`：SwiftUI / WKWebView / PencilKit 原生外壳及原始绘图缓存。
- `packages/protocol`：文档、源码、运行三个版本域和类型协议。
- `packages/runtime-web`：事件驱动 DOM/几何采集与开发期 JSX 身份插件。
- `packages/source-binding`：源码指纹、语法树定位、确定性属性变换和安全路径。
- `packages/document-core`：项目文档、内容哈希、事务、持久化幂等结果。
- `packages/change-engine`、`scenario-runner`：候选构建、真实场景截图、审批哈希与回退。
- `packages/mcp-server`、`plugins/codex`：十三个 MCP 工具和连接/实现/审查技能。
- `packages/agent-provider`、`asset-provider`：显式配置的独立执行者和图像提供方。
- `fixtures/react-monitor`：可重复设备监控样板，包含卡片、表格、图表、表单、弹窗和窄屏布局。

项目文档、笔迹、资产清单、快照、变更与操作日志保存于 `.rdesign/`，不依赖聊天历史。候选隔离在 `.rdesign/candidates/`。环境变量覆盖数据目录后也可独立迁移。工作台支持导出/导入带 schema 的文档；导入不授予源码修改权，也不接受可执行 SVG/HTML 或越界路径。

## 工程文件与工作空间

主页中的每个项目都是可保存、可再次打开的工程。空白设计工程和设备监控模板会创建独立的 React/TypeScript 源码；已有默认工作区登记为关联工程，保留原来的代码和文档位置。浏览器刷新和服务重启会恢复最近打开的有效工程。

```text
.rdesign/
  workspace.json                 # 工程目录、最近打开、收藏、归档及操作收据
  rdesign.project.json            # 原有工作区的关联工程清单
  project.json                   # 原有文档，保持兼容
  projects/<uuid>/
    rdesign.project.json          # 工程身份、模板、版本及相对目录
    source/                       # 独立的可运行 React 源码与资源
    .rdesign/
      project.json                # 画板、批注、场景、资产和变更
      blobs/
      candidates/
      baselines/
```

工程导出为带校验和的 `.rdesign.json` 文件，包含源码、文本和二进制资源、设计文档与历史证据。导入会创建新的独立工程身份；历史变更作为只读记录保留，须在新工程重新生成候选后才能接受。导入不会安装依赖或运行包脚本；源文件路径、内容哈希、凭据、可执行工具配置和符号链接均进行检查。

编辑器通过左上角「工程」返回主页。每个工程的本地草稿单独保存，切换时不自动提交批注。本机管理工程目录，配对设备仅能访问配对时获准且当前已打开的工程。切换会释放输入租约，并关闭无权访问新工程的设备连接。归档保留全部文件；当前活跃工程需先切换后归档。

`/editor` 是当前工程的兼容入口；工程地址为 `/project/<projectId>`。MCP 的 `rd_list_projects` 读取目录，`rd_open_project` 通过版本化请求明确打开工程。

## 接入已有开发项目

启动参数 `RDESIGN_WORKSPACE` 指向明确授权的 React/Vite 项目目录。首版预览运行器适用于常规 `src/`、`index.html`、JSX/TSX 工程，并提供本仓库 React 运行依赖；复杂自定义 Vite 插件、服务代理和其他框架须另设适配。当前使用 `src/` 资源导入；`public/` 不自动映射到根路径，以便严格检查资源文件和符号链接。运行实例需要显式接入 Runtime SDK，源码标识只用于开发构建，不能把未知业务数据变成可写常量。

默认仍使用宿主 React 19。需要 fiber 8 / drei 9 的工程可显式选择[受控 React 18 运行配置](docs/runtime-profiles.md)，使用宿主冻结的 React 18.3.1 与 Three 依赖；工程导入不会安装依赖或执行项目插件。

详见 [Runtime SDK 接入](packages/runtime-web/README.md)。唯一实例上的 JSX 文字常量和内联样式可直接修改；共享节点、动态表达式和未知映射会拒绝回写。外部源码更新会重新读取版本并重载受控页面，不保留临时覆盖。

默认绑定本机。跨设备启动需要 TLS 和准确的授权来源：

```sh
RDESIGN_HOST=0.0.0.0 \
RDESIGN_PUBLIC_ORIGIN=https://your-mac.local:4310 \
RDESIGN_TLS_CERT=/absolute/path/server.crt \
RDESIGN_TLS_KEY=/absolute/path/server.key \
npm run dev
```

证书必须由 iPad 信任且覆盖配置域名。不能跳过证书校验。电脑使用 `https://127.0.0.1:4310` 进入本机入口（证书需覆盖该地址），创建一次性配对码；iPad 访问配置的 HTTPS 地址兑换短期令牌。远端不能调用本机 bootstrap 取管理员令牌。配对码一次有效、90 秒过期；设备可随时撤销。

## Codex 与 AI

[Codex 插件安装及工具模式](plugins/codex/README.md)使用同一 Bridge 和项目。MCP 不传输每帧媒体，也不假设宿主支持内嵌完整画布；工具模式返回同一工作台入口。宿主驱动修改不会隐式再启动另一个执行者。

图像提供方需要在 Bridge 进程明确配置 `OPENAI_API_KEY`、`RDESIGN_IMAGE_MODEL` 和 `RDESIGN_IMAGE_COST_CEILING_USD`。工作台再次要求批准提示词外发和单次预算；默认未配置，不产生模型调用或费用。模型/账户收费与硬限额由提供方决定，配置成本上界只是项目调用前置检查。重复请求使用持久化生成身份；结果不明确时拒绝自动再次收费。

独立代码执行提供 [可运行的 Codex SDK Worker](apps/agent-worker/README.md)，启动命令为 `npm run worker`；须显式配置独立 API 账户、Worker 令牌和单次成本估算上限。默认不启动模型任务。`AgentProvider` 通过独立令牌和候选目录接入该 Worker。配置方法、隔离要求及实际验证边界见 [平台与宿主兼容矩阵](docs/compatibility/host-matrix.md)。工作目录隔离不等于安全沙箱；不连接生产实例，不读取宿主私有凭据。

## 验证

```sh
npm run build
npm test
npm run test:e2e
npm run build --workspace=@rdesign/fixture-monitor
```

端到端测试使用独立临时项目副本、数据目录和 4410/4411 端口，不改变默认样例或用户工作区。覆盖同实例多客户端、真实候选、拒绝版本错位、外部编辑保护、目标回退、离线笔迹、丢失回执重放和授权撤销。

iPad 原生工程见 [构建说明](apps/ipad/README.md)。已提供可编译外壳；Apple Pencil、中文输入、旋转、分屏、多窗口与局域网实际延迟仍需真机验收。Tauri、Windows 原生窗口、多人协作和完整矢量/动画编辑属于方案后续扩展。
