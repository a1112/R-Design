# 腾讯云团队服务部署

团队服务面向项目、设计版本、追溯与审批。它通过 `apps/team-server` 提供服务端 API 和已构建的工作台页面；本地 Bridge 的运行画面、源码候选和 Chromium 执行继续保留在本机，腾讯云不会执行导入工程或启动 AI Worker。

目标入口是 `https://175.178.16.90/r-design/team`。团队 API 位于 `/r-design/api/team/`，静态资产位于 `/r-design/assets/`。nginx 保留 `/r-design` 前缀代理到 `127.0.0.1:4315`。不要把 `proxy_pass` 改成带末尾 `/` 的形式，否则会剥离服务端需要的前缀。

## 服务器和隔离边界

2026-10-14 已只读核验 SSH 别名 `tencent-lighthouse`、Ubuntu 26.04 LTS、Node 22.22.1、nginx 与非交互 sudo。服务器还有 ServerAll、MRD、R-Link 等既有业务；本方案不升级系统 Node、不安装全局 npm 软件、不占用现有服务端口，也不覆盖共享 nginx 主配置。

Node 22.22.1 上 `node:sqlite` 的 `DatabaseSync` 和 `backup` 已实际运行验证，会产生实验特性提示。数据使用 `team.sqlite` 和 SQLite WAL，单实例部署。`backup.mjs` 使用在线备份 API 生成一致快照，不能直接复制正在运行的单个 `.sqlite` 文件。[Node SQLite 文档](https://nodejs.org/docs/latest-v22.x/api/sqlite.html) 与 [Node 发布计划](https://github.com/nodejs/release)说明其 API 和支持周期。

| 项目 | 位置或配置 |
| --- | --- |
| 服务账户 | `r-design-team`，系统账户、禁止交互登录 |
| 发布目录 | `/srv/r-design-team/releases/<revision>` |
| 当前发布 | `/srv/r-design-team/current`，原子切换软链接 |
| 启动 | `/usr/bin/node --import tsx apps/team-server/src/index.ts` |
| 服务单元 | `/etc/systemd/system/r-design-team.service` |
| 数据 | `/var/lib/r-design-team/team.sqlite` 与 WAL 文件 |
| 环境 | `/etc/r-design-team.env`，root 拥有、权限 0600 |
| 一致备份与回退记录 | `/var/backups/r-design-team/<revision>/` |
| nginx 路由 | `/etc/nginx/snippets/r-design-team.conf` |
| 本机访问凭据 | `.rdesign/deployment/team-access.txt`，Git 忽略且限制文件 ACL |

源码和依赖由 `ubuntu` 安装并拥有，服务账户只读发布目录，只能写数据目录。systemd 启用 `NoNewPrivileges`、`ProtectSystem=strict`、`ProtectHome`、私有临时目录与资源上限。该隔离适用于团队 API，不承担执行不可信设计源码的职责。

## 准备与发布

先完成团队服务的类型检查、测试与前端生产构建，确保 Vite 生产 base 为 `/r-design/`。在仓库根目录运行：

```powershell
$env:RDESIGN_WEB_BASE_PATH = '/r-design/'
npm run build
Remove-Item Env:RDESIGN_WEB_BASE_PATH
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/tencent/deploy.ps1 -Revision <已验证的发布标识>
```

默认只准备归档与访问记录，不修改腾讯云服务或 nginx。归档只选取 Git 跟踪文件和 `apps/`、`packages/`、`fixtures/`、`deploy/tencent/` 下明确枚举的新文件，以及本次 `dist/workbench`；排除 `.git`、`.rdesign`、依赖目录、环境文件和证书密钥，并拒绝源文件软链接。每个归档输出 SHA-256，服务器解包前再次校验。

需要在 Linux 上验证本地与临时目录跨盘等平台差异时，可以先安装独立的未激活发布目录：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/tencent/deploy.ps1 -Revision <独立验证标识> -StageRemote
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/tencent/deploy.ps1 -Revision <独立验证标识> -VerifyRemote
```

`-StageRemote` 只上传、校验、解包并安装锁定依赖，不创建运行账户、团队环境、数据、生产服务或 nginx 路由。`-VerifyRemote` 还在该发布目录安装独立的测试 Chromium，运行完整 Vitest、默认路径构建、Bridge 与团队端到端测试，再以 `RDESIGN_WEB_BASE_PATH=/r-design/` 重建前端，用 `RDESIGN_TEAM_E2E_BASE_PATH=/r-design` 实际验证生产前缀的登录 cookie、资产、API 和审批流程。测试使用临时工程与测试端口，保持 `current` 和团队数据不变。发布前再次检查 index 的脚本与样式均指向 `/r-design/assets/`；源文件在两次归档之间发生修改时，必须使用新的验证标识，避免复用不同内容的发布目录。

新的验证目录可加 `-ReuseRevision <已安装依赖的验证标识>`，服务器先比较两份 `package-lock.json` 的 SHA-256，完全一致才复制已锁定的 Linux 依赖。复制包含根目录及 `apps/`、`packages/`、`fixtures/` 下各工作空间的独立依赖树；保留 npm 工作空间的相对链接，使其绑定到新目录源码。脚本校验路径均位于发布目录，直接核验 React 18 全部冻结依赖版本后才记录完成标记。复制或安装失败后重试，会保留并隔离未完成依赖树，再重新准备，禁止替换当前运行目录的依赖。更改过的验证目录需要标记 `.verification-modified`，安装脚本拒绝直接发布此目录，必须重新生成完整归档。

浏览器只用于隔离验收，生产团队服务不会启动 Chromium。官方 CDN 单连接下载较慢时，可用 `deploy/tencent/download-chromium.py --browsers-json <发布目录>/node_modules/playwright-core/browsers.json --destination /srv/r-design-team/tooling/headless-shell --parallel 8`，从 Google 官方固定版本 ZIP 并行 Range 下载，校验全部 ZIP CRC 后安装。脚本支持明确指定现有 loopback HTTP 代理，不创建新代理或转发。验证阶段核对浏览器 `--version` 与锁定的 Playwright 元数据，并通过 `RDESIGN_BROWSER` 启动；没有独立浏览器时使用 Playwright 官方 `--only-shell` 安装。

收到本次验证通过后，使用同一发布标识发布：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/tencent/deploy.ps1 -Revision <已验证的发布标识> -Publish
```

SSH 与 SCP 始终启用 `BatchMode=yes`、`StrictHostKeyChecking=yes`、`ClearAllForwardings=yes`。管理员随机密码仅写入本机忽略目录，并通过 SSH 标准输入传递；禁止粘贴密码、环境文件或访问记录到聊天、终端日志或 Git。首次部署创建环境与管理员；再次部署保留已有环境、用户和数据，不重置管理员。

安装通过独立的 `npm@11.13.0` 执行锁定的 `npm ci --include=dev --ignore-scripts`，匹配本机锁文件生成版本，保留启动所需 `tsx`。服务器原有 npm 9 对本项目 overrides 的锁文件解析不兼容，因此只使用独立 CLI 和缓存，不修改系统 npm。发布独立 systemd 单元后先检查 loopback 健康，再向现有 HTTPS server block 添加一行专用 snippet include。脚本会备份原配置、重新读取并拒绝并发修改；`nginx -t` 通过后才 reload，最后检查公开健康与页面。

## 环境变量

全部配置使用 `RDESIGN_TEAM_` 前缀：`PORT=4315`、`HOST=127.0.0.1`、`DATA_DIR=/var/lib/r-design-team`、`PUBLIC_ORIGIN=https://175.178.16.90`、`BASE_PATH=/r-design`、`STATIC_DIR=/srv/r-design-team/current/dist/workbench`。`ADMIN_EMAIL`、`ADMIN_PASSWORD`、`ADMIN_NAME` 仅用于空用户表的首次管理员初始化。已有管理员必须通过账户管理流程更改，部署变量不会重置密码。

nginx 传入原始 `Host` 和明确的 `X-Forwarded-Proto: https`，服务端只信任 loopback 反代。匿名健康接口 `/r-design/api/team/health` 只返回健康状态，不公开账户、数据库位置或版本明细。团队路由关闭 nginx access log，避免未来认证参数写入查询日志。

## 验收

```sh
sudo systemctl is-active r-design-team
curl --fail https://175.178.16.90/r-design/api/team/health
curl --fail --head https://175.178.16.90/r-design/team
sudo nginx -t
sudo systemctl is-active mrd-public-tls-renew.timer
```

再使用本机访问记录登录，完成项目、设计版本、审批和追溯的一次实际流程，并确认服务重启后仍可读取保存的数据。不要把包含会话 cookie、Bearer token 或密码的输出公开。

已有 IP HTTPS 证书 SAN 覆盖 `175.178.16.90`。审计时证书到期时间为北京时间 2026-10-19 05:08:40，已有 `mrd-public-tls-renew.timer` 自动续签。部署只验证 timer 活跃，不更改既有续签流程。[腾讯云 HTTPS 文档](https://cloud.tencent.com/document/product/1207/84359)建议部署后实际访问验证。

## 2026-10-14 上线前验收记录

本次 Linux 检查在独立未激活目录完成，未启动生产团队服务或写入团队数据。基线全量 Vitest 取得 276 项通过、16 项失败、1 项 Windows 专属跳过；失败随后定位为依赖复用遗漏工作空间中的 React 18 嵌套依赖、宿主别名与传递依赖处理问题，以及恢复场景缺少默认浏览器缓存。修复后复验全部相关组，没有遗留失败。

| 平台与检查 | 结果 |
| --- | --- |
| Linux 最新失败组与安全复验，`maxWorkers=2` | 8 文件，76 通过、1 Windows 专属跳过，89.29 秒，退出码 0 |
| Linux 上述分组明细 | runtime profiles 25、renderer syntax 8、shared intrinsic 2、WebGL 2、textarea 1、scenario recovery 1、安全边界 16 通过及 1 跳过、团队服务 21 |
| Linux 团队 `/r-design` 生产前缀端到端 | 2 场景通过，5.9 秒；验证登录、持久化追溯、独立审批、移动布局、层坐标和版本比较 |
| Linux 生产构建 | 类型检查与 Vite 构建通过，`RDESIGN_WEB_BASE_PATH=/r-design/`，1593 模块 |
| Windows runtime profiles 与安全边界 | 42 项通过 |
| Windows 工程与工作空间 | 53 项通过 |
| Windows 团队服务、导入、源码与 Vite 边界 | 27 项通过 |
| Windows 团队端到端 | 默认路径 2 场景与 `/r-design` 前缀 2 场景均通过，截图已检查 |
| Windows 既有工作台端到端 | 组合验收 23 场景通过 |
| Windows 生产构建 | 类型检查与 `/r-design/` 前缀 Vite 构建通过 |
| 部署工具 | PowerShell 语法、Bash 语法、备份脚本语法、nginx 路由 8 项回归、共享 nginx 检查与 systemd 单元校验通过 |

Windows 曾在 L 盘临时目录遇到 IO 超时和 Vite 跨盘路径限制；相关失败场景已使用默认 C 盘临时目录重新运行并通过。Linux 通过真实 Node 22.22.1 与锁定 Chromium 验证，不将临时目录超时归为已通过用例。

本地冻结 PDF 5 兼容层仍保留已知依赖审计残余，未在本次合并中升级其运行图。云端团队服务仅接受并验证栅格设计证据，不加载 PDF 运行器、不执行导入源码；本次验收不表示旧 PDF 兼容依赖已消除全部审计项。

2026-10-14 发布前重新执行 `npm audit --json`：当前锁文件报告 3 项高危、7 项低危、无严重项。高危条目为 PDF.js 5 以及 React Router / React Router DOM；低危条目来自 DOMPurify、KaTeX 及其消费库。团队服务与工作台源码未导入这些库；它们用于本地工程兼容运行图。告警仍保留，应按对应工程的运行约束另行升级并回归，不能把本次权限或运行器边界测试当作依赖漏洞已修复。完整审计结果位于本机忽略目录 `.rdesign/verification/npm-audit-current.json`。

## 2026-10-14 最终上线记录

正式应用发布为 `rdesign-a0a5c54-20261014`，对应应用与部署代码提交 `a0a5c54`；`current` 指向同名 release。团队服务实际处于 active/running，并已启用开机启动。公开 HTTPS 页面、健康接口、JS/CSS 资源、真实浏览器登录和退出、匿名权限隔离、私有文件路径拒绝、手机布局及服务重启后的原会话与管理员身份保留均已通过，浏览器无错误。独立 Node 公网复验再次通过同样的登录、资产与退出检查。

初始生产数据库只有一个管理员，没有演示项目。`/etc/r-design-team.env` 为 root 的 0600 文件；数据库为服务账户的 0600 文件。在线 SQLite 一致备份位于 `/var/backups/r-design-team/rdesign-a0a5c54-20261014/team.sqlite`，完整性检查为 `ok`；回退记录指向 `/srv/r-design-team/releases/rdesign-a33f4e7-20261014`。nginx 配置检查与既有 TLS 续签 timer 检查通过。首次发布和 nginx 重载时序问题已修复；公开健康等待有 30 秒期限，必须返回 200 和准确的健康 JSON，超时仍回退。

合并引入的 Python 版本管理工具也完成 Windows 修复：现有 Python 3.12 的 44 项原有测试全部通过，版本一致性检查通过。POSIX 保留文件描述符权限操作，Windows 在校验临时文件身份后保留平台实际支持的权限；原子替换与回退流程保留。

管理员访问记录仅保存在本机忽略目录 `.rdesign/deployment/team-access.txt`，状态为 `deployed`，该文件不进入 Git。生产桌面与移动截图位于同目录的 `production-team-desktop.png` 和 `production-team-mobile.png`。

## 备份和回退

每次发布前，如果数据库存在，安装脚本执行：

```sh
sudo node /srv/r-design-team/current/deploy/tencent/backup.mjs \
  /var/lib/r-design-team/team.sqlite \
  /var/backups/r-design-team/manual-<时间>/team.sqlite
```

归档包含 `previous-release.txt`、`nginx.previous`、已有 snippet/单元的副本与一致数据库快照。发布失败时脚本恢复上一发布与原 nginx 配置并重启 R-Design；如果 nginx 被其他进程并发修改，保留备份并停止自动覆盖，需人工核对差异。数据库始终保留，避免丢失发布期间的新写入。

手动回退应用时，先核对上一版本和当前数据库 schema 兼容，再把 `current` 原子切回 `previous-release.txt` 指向的已保留目录，重启 `r-design-team` 并运行上述验收。禁止回退其他服务或整个服务器。

如果必须恢复数据，先停止 `r-design-team`，把现有 `team.sqlite`、`team.sqlite-wal` 和 `team.sqlite-shm` 一并移入带时间标识的隔离目录，再把一致快照安装为 `/var/lib/r-design-team/team.sqlite`，恢复 `r-design-team:r-design-team` 所有权与 0640 权限，启动服务并验收。此步骤会回到备份时的数据，应先核对需要保留的新写入。服务运行时不能替换数据库，也不能只恢复 WAL 中的某一个文件。

长期备份应把一致快照复制到独立备份存储并限制权限；管理员密码和会话数据也属于敏感备份。首次上线保持单实例，扩展多实例前需要重新设计写入协调、迁移与共享会话。
