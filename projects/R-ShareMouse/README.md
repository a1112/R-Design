# 公开桌面项目的阶段配置

仅包含 R-ShareMouse、R-Link 的配置、通用准备/验证工具与无源码、无截图的摘要。源项目均为公开仓库。完整候选包与原分辨率证据留在本地忽略目录；其他工程采用同权限交付。

R-Design 原始基线：ffaba7c22b7d027e78ebccbbae17f2c5d4ba1ab7。冻结工具探测：fd563274e0add377460ec537729675af9b52a3ac。共享工具与根依赖/锁文件均未修改。

| 项目 | 精确源 SHA | 源文件 / 实际截图 | 正式导入 |
| --- | --- | --- | --- |
| R-ShareMouse | `2f5d8a489a0622d4b56687ffe692e7ae30af310d` | 105 / 3 | IMPORT_CONFIG 阻碍 |
| R-Link | `c7d45379038010face712f20f84d67f4e6b0e81b` | 145 / 3 | IMPORT_CONFIG 阻碍 |

R-ShareMouse 在冻结运行核心加独立项目依赖下通过三个场景、生产构建、设置切换和原生服务拒绝；真实 ChangeEngine.prepare 通过，官方候选构建因 qrcode-generator 缺失而失败，隔离预演文字回读通过。候选未接受，交付源码未改。

R-Link 三场景来自 ffaba7c2 加独立依赖的真实应用，设备管理路由和窗口拒绝已验证；不能当作新工具的正式复验。两个项目都由严格冻结导入器实际拒绝，正式通过数为 0。

完整包为 `.rdesign/desktop-deliverables/<项目>.rdesign-project.json`；截图与帧为 `.rdesign/desktop-evidence/<项目>/`。逐文件与 payload checksum、文档/资源校验、原资源无损重建均通过，依赖政策单独记为阻碍。包内源码、资源与截图不包含在本分支。

source adapter.json 为真实适配配置；generator-probe-config.json 仅用于原始提交兼容探测，不是假称完成的适配生成配置。原项目保持固定 SHA 干净检出，Git 对象读取拒绝 replace refs，不执行原始脚本/Vite 配置。

冻结宿主仅登记三个固定运行包。所需具体依赖与版本见 dependency-integration-request.json。React 18 到 19 的已运行入口、编译 CSS、新增纯预览边界和大图分段仍需宿主接口审查。保留的可选日历 react-day-picker 8.10.1 尚无 React 19 peer 支持，不记为通过。

R-ShareMouse 的 390px 原桌面布局有七个控制横向超出视口；捕获通过不表示完成移动布局适配。真实 daemon、设备控制、SSH、账户服务等不可用，不模拟为成功。

```sh
npm ci --ignore-scripts --legacy-peer-deps --prefix projects/R-ShareMouse/tooling/dependencies
RDESIGN_PREFLIGHT_BUILD=true node --import tsx projects/R-ShareMouse/tooling/verify.ts R-ShareMouse
node --import tsx projects/R-ShareMouse/tooling/generate-candidate.ts R-ShareMouse
```

负责人正修复 Git 来源、CSS import、依赖范围和资源 hash 四项共享边界。新 SHA 到达后，仍须正式导入并重新采集运行/候选证据。

## 候选 checksum

- R-ShareMouse: `d90f482ebcd5cdce485df7fcd05ede5b6f7628bdc05cbc043b81757bf2680b81`
- R-Link: `2d7614e587e2f2f55dabcca90b8a5d3e7d4c2f2c48140e78a50cd31146eb6432`
