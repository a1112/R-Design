# 公开桌面项目的阶段配置

本分支包含 R-ShareMouse、R-Link 的配置、通用准备/验证工具和无源码、无截图的摘要。完整源码、资源候选包和原分辨率证据保存在本地忽略目录。共享工具、根依赖和锁文件未修改。

R-Design 原始基线 `ffaba7c22b7d027e78ebccbbae17f2c5d4ba1ab7`；已合 main `4711119ade3c534ecd261c51792cecbe49a6f8ff`；本次验收宿主为未合并的候选 `d4f41d0e7ab552129a82d91648ecd3dade692de9`。Draft PR3 对准 main，暂不合并。

| 项目 | 精确源 SHA | 源文件 / 截图 | 正式打包 / 导入 |
| --- | --- | --- | --- |
| R-ShareMouse | `2f5d8a489a0622d4b56687ffe692e7ae30af310d` | 114 / 3 | IMPORT_CONFIG 阻碍 / 阻碍 |
| R-Link | `c7d45379038010face712f20f84d67f4e6b0e81b` | 147 / 3 | IMPORT_CONFIG 阻碍 / 阻碍 |

两项已在该候选的实际运行核心加显式项目依赖下，重新通过六个场景、原 UI 路由/设置交互、原生命令拒绝、精确 JSX 映射、资源字节还原和轻量构建。隔离预览使用声明的页面就绪条件；这不是正式导入或候选接受证明。正式 pack-prepared、preflight 与 import 均被依赖政策实际拒绝，通过数为 0；accept/revert 尚未执行。

完整 v1 候选包位于 `.rdesign/desktop-deliverables/<项目>.rdesign-project.json`，不是仅文档导出。包含源码资源、场景和真实帧；payload 与逐文件 checksum、文档/资源结构、敏感路径/凭据扫描通过，依赖政策单独记为阻碍。

`prepared-packing.config.json` 是完整预备工程的正式打包配置。`src/rdesignPackingLedger.json` 对照精确提交核对原始/适配摘要；大图另有 JSON 分片账本，原应用所用 raw 分片也完整保留。`generator-probe-config.json` 只检查原始入口，不能当作完整适配配置。

优先登记需求和精确版本见 [dependency-matrix.md](dependency-matrix.md)、dependency-integration-request.json 与逐项 prepared-packing-summary.json。保留的可选日历有 React 19 peer 冲突，未执行可选组件不计通过。R-ShareMouse 的窄屏原桌面布局有七个控件横向裁切；捕获通过不代表移动布局适配。

实际 daemon、设备控制、SSH、账户服务等均不可用。不会把 fixture、浏览器内存或空 UI 当作真实后端成功。

在本仓库旁建立 `../frozen-tool` 并检出上述候选、安装其锁文件；源项目放在 `../sources/<项目>` 并检出 adapter.json 中的精确提交。

```sh
npm ci --ignore-scripts --legacy-peer-deps --prefix projects/R-ShareMouse/tooling/dependencies
node projects/R-ShareMouse/tooling/recheck.mjs R-ShareMouse R-Link
node --import tsx projects/R-ShareMouse/tooling/integration-checkpoint.ts R-ShareMouse R-Link
```

## 候选 checksum

- R-ShareMouse: `4afdb3066a3f63bf7229ca74ff9641c5bcd9991bd56804e6b22bbe293f96074b`
- R-Link: `496d50b09a0d6ed05b2cba99d59cb3a636d3b790a8c8ff0a35b101713a36f0b9`

只有父任务的最终受审工具能够决定正式兼容状态。收到最终 SHA 后，仍须重新正式导入并验证候选接受、撤销和窄屏场景。
