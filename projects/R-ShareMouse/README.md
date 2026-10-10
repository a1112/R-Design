# 通用桌面工程：公开配置与适配

R-ShareMouse、R-Link 的完整 v1 工程已在已合并的冻结 main 提交 `11e2461ecabcbed1be938fefb08a7a6b73bc2629` 通过正式导入与运行验收。PR4 已合并；该 main 的完整 Git tree 与独审候选相同，证明见 [host-merge-verification.json](host-merge-verification.json)。Draft PR3 只发布这两项公开项目的配置、自写适配、通用工具和脱敏摘要，完整源码资源包与原分辨率截图保留本地。

两项共 7 个不同场景，通过真实 ProjectWorkspace 导入、生产构建、原路由交互、精确 JSX 映射、候选接受与语义回退，以及实际 Workbench 文件选择器导入和新 Bridge/新浏览器重启。重复 Bridge 捕获是同一批场景。回退只保证语义。原生及真实后台能力验收为 0；预览会明确拒绝相应操作。

本次修复四项复核问题，证据见 [review-fixes-summary.json](review-fixes-summary.json)：

- 冻结宿主和源仓库使用真实 Git 对象，逐文件核对工作树字节及执行标记；`git replace` 和 `assume-unchanged` 无法隐藏替换源码。只为 Git 子进程设置环境，不修改用户 Git 配置。
- 准备阶段拒绝根目录、祖先、子文件的符号链接及共享 inode；独占创建新的自有副本并核对 inode 与字节。响应式适配通过 no-follow 句柄写入已检查的自有 inode，元数据写入同样拒绝别名。原始 prepared 输入保持原字节和 inode。
- ShareMouse 保存并恢复跨断点的桌面 zoom/pan；窄屏手动选择保留到显式重置。四组同页面 `1440 → 390/320 → 1440` 浏览器测试覆盖默认及实际按钮/鼠标拖动后的视图，桌面分别恢复为 1.0 和 0.85 及原平移；同时验证窄屏选择保留、重置拟合、document time origin 和 URL 不变。
- 旧 `check-packing` 在正式打包或预检失败时返回非零，`recheck` 还检查同项目/宿主的通过证据。即使失败的子进程返回零，也不会继续生成候选。

9 项合成目录回归全部通过，包含实际 hostModule、响应式适配 CLI、失败 packer/preflight 和 recheck 的执行路径。修复后的 ShareMouse 包重新通过 4 个正式场景、两份独立导入、交互/映射、候选接受及语义回退、实际 Workbench 导入与全新进程重启；Link 保留此前已验收工程，其源码没有变化。

ShareMouse 的 390×844、320×844 控件命中、焦点和祖先裁切检查通过，横向溢出和裁切为 0；7 个设置导航项及三种主题有实际状态回读。CSS 仅在 640px 以下改变布局，跨断点仅保存/恢复原画布状态。源适配摘要见 [responsive-adaptation-summary.json](responsive-adaptation-summary.json)，运行与重启结果见 [official-validation-summary.json](official-validation-summary.json)、[official-workbench-summary.json](official-workbench-summary.json)。

复现时在仓库旁建立 `../frozen-tool`，检出上述精确 main SHA 并正常按锁安装；两个源仓库位于 `../sources/<项目>`，检出各自 adapter.json 中的精确 SHA。负责人提供的 prepared-source handoff 固定于 `3fba881610f73705c1da026d0ed5298d79855441`，工具核对它是当前 main 的真实祖先；它仅提供源适配，兼容性由实际 main 验收建立。副本必须新建，已有输出不会被覆盖；可为新一轮指定新的 namespace/variant。

```sh
npm ci --ignore-scripts --prefix ../frozen-tool
node --test projects/R-ShareMouse/tooling/tests/engineering-guards.test.mjs
RDESIGN_PREPARED_HANDOFF_SHA=3fba881610f73705c1da026d0ed5298d79855441 RDESIGN_PREPARED_OUTPUT_NAMESPACE=pr3-review-fixes node projects/R-ShareMouse/tooling/prepare-official.mjs "$RDESIGN_DESKTOP_HANDOFF" R-ShareMouse R-Link
node projects/R-ShareMouse/tooling/apply-sharemouse-responsive.mjs
mkdir -p .rdesign/desktop-official-deliverables
node --import ../frozen-tool/node_modules/tsx/dist/loader.mjs ../frozen-tool/scripts/engineering.ts pack-prepared projects/R-ShareMouse/official-packing.config.json .rdesign/desktop-official-deliverables/R-ShareMouse.11e2461.review-fixes.rdesign-project.json
node --import ../frozen-tool/node_modules/tsx/dist/loader.mjs ../frozen-tool/scripts/engineering.ts pack-prepared projects/R-Link/official-packing.config.json .rdesign/desktop-official-deliverables/R-Link.11e2461.rdesign-project.json
RDESIGN_BUNDLE_VARIANT=review-fixes node --import ../frozen-tool/node_modules/tsx/dist/loader.mjs projects/R-ShareMouse/tooling/official-verify.ts R-ShareMouse
node --import ../frozen-tool/node_modules/tsx/dist/loader.mjs projects/R-ShareMouse/tooling/official-verify.ts R-Link
RDESIGN_BUNDLE_VARIANT=review-fixes node --import ../frozen-tool/node_modules/tsx/dist/loader.mjs projects/R-ShareMouse/tooling/official-workbench.ts R-ShareMouse
node --import ../frozen-tool/node_modules/tsx/dist/loader.mjs projects/R-ShareMouse/tooling/official-workbench.ts R-Link
```

只使用冻结宿主已登记的依赖，没有 peer 强制、项目依赖安装或 runtime 覆盖。正式工具和真实准备/适配流程在无根及项目 node_modules 的公开工作区通过检查，该副本与正式验收副本逐文件相同且 inode 独立。浏览器 headless、端口临时独立，没有 Rust 构建或前台窗口操作。

当前交付包的 payload checksum（新打包的 manifest 时间戳会产生新的 checksum）：

- R-ShareMouse：`413b6502cf191df34e7653b22da505b347060dfbd2dc567df83b21ff0ede1539`，116 个源码/资源文件。
- R-Link：`f0d3136250bbed024beec91c7979b0281227971b9d880291eebb47b22ca921cb`，148 个源码/资源文件。

旧 ShareMouse 包与历史运行记录仍保留；本轮使用单独的 `review-fixes` 文件名。完整工程包含源文件、静态资源、映射/场景配置和来源账本，省略 .env、凭据、真实私人数据、node_modules 及 Git 历史。不可达模块以逐字节引用保留，可选模块未启用且不计能力验收。
