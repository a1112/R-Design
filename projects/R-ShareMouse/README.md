# 公开桌面项目的正式验收配置

R-ShareMouse、R-Link 在冻结 PR4 候选 `3fba881610f73705c1da026d0ed5298d79855441` 上通过正式完整工程导入和运行验收。本分支仅发布这两项的配置、通用准备/验证工具及无源码、无截图的摘要。完整源码资源包和原分辨率证据保存在本地忽略目录；共享核心、根依赖和锁文件未修改。

交接时 main 为 `eeffd77924463dcfec05ba1b438e92047d495a23`。PR4 尚待独立审查并未合并，Draft PR3 对准 main。以下结果只适用于实际冻结候选，不能认定 main 已兼容。

| 项目 | 精确源 SHA | 源文件 / 原 UI 场景 | 正式打包、导入、运行、变更与重启 |
| --- | --- | --- | --- |
| R-ShareMouse | `2f5d8a489a0622d4b56687ffe692e7ae30af310d` | 115 / 3 | 通过 |
| R-Link | `c7d45379038010face712f20f84d67f4e6b0e81b` | 148 / 3 | 通过 |

`official-*` 摘要和配置为当前证据。原来的 `integration-summary.json` 等记录 d4 阶段依赖阻碍，属于历史预览；旧的隔离依赖工具不用于本次正式验收。

两项都通过实际 v1 schema/checksum、正式 pack-prepared/preflight、两份独立源码导入、生产构建、六个原 UI 场景、原路由交互和精确 JSX 源码映射。ChangeEngine 实际构建并验证候选，接受后从 DOM 回读指定实例文字，再语义回退并持久化 reverted 状态；另一份导入副本保持原状态。语义回退不保证源码字节或 codeRevision 相同。

`official-workbench-summary.json` 另记录实际 Workbench 文件选择器导入、打开真实画布、Bridge 场景采集和进程重启。新 Bridge 进程与新浏览器恢复原活动工程和三份快照，运行实例 ID 发生变化。Bridge 对同一批场景的重复采集不增加不同场景数量。

完整 v1 工程包含应用源码和静态资源。不可达可选模块分别以 47 / 55 个 `.reference.txt` 文件按字节保留；`src/rdesignPackingLedger.json` 记录前后入口图、原 SHA、逐文件摘要和显式适配。它们未执行；启用时需单独审查依赖。图标导入显式改为 `lucide-react-v0487@0.487.0`，宿主原版本保留。react-day-picker@8.10.1 未安装、未运行，不计 React 19 兼容。

两项的 daemon、设备控制、原生 IPC、SSH 和真实服务均不可用。验收检查实际按钮或原生 helper 明确拒绝，没有成功模拟。R-ShareMouse 原窄屏布局仍有 7 个控件横向裁切，场景采集通过不等于移动布局验收通过。

在本仓库旁建立 `../frozen-tool`，检出上述冻结 SHA 并按宿主锁文件正常安装；源项目位于 `../sources/<项目>` 并检出精确提交。`prepare-official.mjs` 读取负责人提供的冻结 handoff，逐字节复制其已登记适配并生成本地正式配置；不会覆盖已有输出。

```sh
npm ci --ignore-scripts --prefix ../frozen-tool
node projects/R-ShareMouse/tooling/prepare-official.mjs "$RDESIGN_DESKTOP_HANDOFF" R-ShareMouse R-Link
mkdir -p .rdesign/desktop-official-deliverables
node --import ../frozen-tool/node_modules/tsx/dist/loader.mjs ../frozen-tool/scripts/engineering.ts pack-prepared projects/R-ShareMouse/official-packing.config.json .rdesign/desktop-official-deliverables/R-ShareMouse.3fba881.rdesign-project.json
node --import ../frozen-tool/node_modules/tsx/dist/loader.mjs ../frozen-tool/scripts/engineering.ts pack-prepared projects/R-Link/official-packing.config.json .rdesign/desktop-official-deliverables/R-Link.3fba881.rdesign-project.json
node --import ../frozen-tool/node_modules/tsx/dist/loader.mjs projects/R-ShareMouse/tooling/official-verify.ts R-ShareMouse
node --import ../frozen-tool/node_modules/tsx/dist/loader.mjs projects/R-ShareMouse/tooling/official-verify.ts R-Link
node --import ../frozen-tool/node_modules/tsx/dist/loader.mjs projects/R-ShareMouse/tooling/official-workbench.ts R-ShareMouse R-Link
```

只使用冻结宿主已登记的依赖，不安装项目独立依赖、不覆盖 runtime，不使用 force 或 legacy peer 参数。浏览器采用 headless 与独立临时 loopback 端口，不进行 Rust 构建。

当前 v1 payload checksum：

- R-ShareMouse：`27ee0b64e43a67460ad6bf30f204e736bfc1f44ec32ad0b70354127f513df70a`
- R-Link：`729a2689633b6b022cf3750ae7358900049bc43afa394f3980a27f0b513e4810`

逐项完整文件 SHA-256、schema/preflight、业务步骤、源码绑定与重启检查见相应 `official-validation-summary.json` 和 `official-workbench-summary.json`。完整工程导入后的历史场景证据按规则重置为 unverified；本次运行重新建立正式验收证据。
