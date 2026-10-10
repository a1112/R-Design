# 公开桌面工程的最终 main 验收配置

R-ShareMouse、R-Link 已在最终 main `11e2461ecabcbed1be938fefb08a7a6b73bc2629` 重新生成完整 v1 工程并正式验收。PR4 已合并；该 main 的完整 Git tree `6e48722ec0602247510ef8c413137c959b36c3a1` 与独审候选 `eaaab0859e63b84d9f0b8dcf383a3b0c7b549437` 相同，证明见 host-merge-verification.json。Draft PR3 仍只发布两项公开项目配置、自写适配、通用测试工具和脱敏摘要，完整源码资源和原分辨率截图保留本地。

| 项目 | 精确源 SHA | 源文件 / 不同场景 | 正式导入、运行、变更、重启 |
| --- | --- | --- | --- |
| R-ShareMouse | `2f5d8a489a0622d4b56687ffe692e7ae30af310d` | 116 / 4 | 通过 |
| R-Link | `c7d45379038010face712f20f84d67f4e6b0e81b` | 148 / 3 | 通过 |

两项的真实 v1 schema/checksum、正式 pack-prepared/preflight、两份独立源码导入、生产构建、7 个不同原 UI 场景、原路由交互和精确 JSX 源码映射通过。ChangeEngine 接受真实变更后从 DOM 回读，再语义回退并持久化 reverted 状态；另一份导入副本保持原状态。语义回退不保证字节或 codeRevision 相同。

actual Workbench 文件选择器导入和新 Bridge/新浏览器重启通过，同一活动工程和全部快照恢复，运行实例 ID 改变。Bridge 的重复采集不增加不同场景数量。逐项证据、完整文件 SHA-256 与截图目录见 official-validation-summary.json 和 official-workbench-summary.json；历史 integration-summary 等保留旧 d4 预览状态，不能代表当前正式验收。

R-ShareMouse 原来的 7 个裁切控件已在工程适配层修复。自写 CSS 让标题栏换行、侧栏纵向排列、设置导航垂直滚动、提示参与正常布局；画布通过原 zoom/pan 状态适配窄屏，重置按钮保留该逻辑。390×844 与 320×844 均验证这 7 个控件完整可见、实际命中和聚焦，裁切与横向溢出为 0。侧栏切换、缩小/重置、Tab 导航、7 项设置导航、三种主题实际状态回读都通过。新增设置外观窄屏场景使用真实点击步骤。适配仅在 <=640px 生效，未修改上游 source checkout；原 SHA、原文件摘要和适配前后差异见 responsive-adaptation-summary.json 及打包账本。

完整工程保留应用源码和静态资源；47 / 55 个入口不可达可选模块按字节保留为 `.reference.txt`。账本保存入口图和逐文件来源。它们未执行，启用时需另行登记依赖。图标导入显式使用 lucide-react-v0487@0.487.0，宿主原版本保留；react-day-picker 未安装、未测试。

daemon、设备控制、原生 IPC、SSH 和真实后台均明确不可用。实际窗口和服务按钮触发不可用反馈，没有成功模拟；这些外部能力验收为 0。

在仓库旁建立 ../frozen-tool 并检出最终 main SHA，按其锁文件正常安装；源项目位于 ../sources/<项目> 并检出精确源提交。负责人提供的 prepared-source handoff 在 3f 阶段冻结；必须显式指定它的 SHA，且工具核对它是当前 main 的祖先。该 handoff 仅提供源码适配，最终兼容性由实际 main 运行验收建立。

```sh
npm ci --ignore-scripts --prefix ../frozen-tool
RDESIGN_PREPARED_HANDOFF_SHA=3fba881610f73705c1da026d0ed5298d79855441 node projects/R-ShareMouse/tooling/prepare-official.mjs "$RDESIGN_DESKTOP_HANDOFF" R-ShareMouse R-Link
node projects/R-ShareMouse/tooling/apply-sharemouse-responsive.mjs
mkdir -p .rdesign/desktop-official-deliverables
node --import ../frozen-tool/node_modules/tsx/dist/loader.mjs ../frozen-tool/scripts/engineering.ts pack-prepared projects/R-ShareMouse/official-packing.config.json .rdesign/desktop-official-deliverables/R-ShareMouse.11e2461.rdesign-project.json
node --import ../frozen-tool/node_modules/tsx/dist/loader.mjs ../frozen-tool/scripts/engineering.ts pack-prepared projects/R-Link/official-packing.config.json .rdesign/desktop-official-deliverables/R-Link.11e2461.rdesign-project.json
node --import ../frozen-tool/node_modules/tsx/dist/loader.mjs projects/R-ShareMouse/tooling/official-verify.ts R-ShareMouse
node --import ../frozen-tool/node_modules/tsx/dist/loader.mjs projects/R-ShareMouse/tooling/official-verify.ts R-Link
node --import ../frozen-tool/node_modules/tsx/dist/loader.mjs projects/R-ShareMouse/tooling/official-workbench.ts R-ShareMouse R-Link
```

只使用冻结宿主已登记的依赖，没有 peer 强制、项目独立安装或 runtime 覆盖。正式工具已在无根/项目 node_modules 的公开工作区检查；浏览器 headless、端口临时独立、未做 Rust 构建。

当前完整 v1 payload checksum：

- R-ShareMouse：`1e6e86104481f6a7310b163e3798eceb3d255f776e03572008543a9eb3edddb9`
- R-Link：`f0d3136250bbed024beec91c7979b0281227971b9d880291eebb47b22ca921cb`
