# @louchi1984/dsh-auto-update

DeepSeek Harness 自动更新插件（host + client 双半区）。

## 适用范围

适用于标准的 **DeepSeek Harness Web UI**（`dsh web` / `web` profile）。插件只使用 Web UI 提供的 `webServer` 与 `slots` 服务，**不依赖任何特定原生壳**。原生壳若带有进程看门狗可以协助拉起更新后的 Web UI；没有壳时，插件会按原启动参数自行兜底重启。

## 界面预览

入口位于**左侧边栏最底部、与“设置”同一行的右侧**。侧边栏入口用低干扰的状态图标提示更新进度：

| 状态 | 图标与提示 | 含义 |
|---|---|---|
| 已是最新 | 对勾 ✓ | 当前 DSH 已是最新版本；点击可查看详情或手动重新检查。 |
| 有新版 | 下载箭头 + 琥珀色呼吸点 | 发现可更新版本；点击打开详情卡片，查看版本和更新日志。 |
| 检查中 / 安装中 / 重启中 | 旋转加载图标 | 正在处理更新；详情卡片会自动展开以显示进度。 |
| 异常 | 圆圈感叹号 + 红点 | 检查、安装或重启发生错误；点击查看错误详情并重试。 |

点击入口可打开详情卡片，查看版本、检查时间、更新日志和安装操作。

## 功能

- **自动扫描**：启动后 15 秒做首次检查，之后每 6 小时一次；对比 npm 上 `@deepseek-ai/dsh` 的
  `latest` / `next` 两个通道与当前运行版本。检查源优先 npm 官方仓库
  `registry.npmjs.org`（国内可直连但偶发慢/超时），失败或超时自动 fallback 到国内镜像
  `registry.npmmirror.com`，与 GitHub 无关；**安装始终走你 npm 自身配置的 registry**。
  最近一次检查实际使用的源记录在状态里（`status.registrySource`）。
- **侧边栏入口 + 详情卡片**：左下角侧边栏底部常驻图标按钮（保持弱化、不突显，仅以
  彩色小点提示状态：对勾 ✓ = 已最新（安装完成后自动重启、重启即回到已最新，无独立状态）、
  琥珀色呼吸点 = 有新版、红点 = 异常）；点击展开右上角详情卡片：版本对比（当前 → 目标）、
  通道与发布时间，提供「更新日志 ↗ / 稍后 / 下载并安装」。安装 / 重启 / 异常时卡片自动弹出，可收起。
- **一键安装**：以你的权限执行 `npm install -g @deepseek-ai/dsh@<tag>`
  （cache 指到 `$DSH_HOME/.npm-cache`，绕开本机 `~/.npm` 的 root 属主问题），实时展示安装日志。
- **自动重启 + 自动刷新**：安装成功后 **3 秒自动重启** dsh web（不提供取消，装完即生效）。
  **双平台**：macOS/Linux 用独立 `/bin/sh` 脚本 SIGTERM 优雅关停；如果存在宿主看门狗会由它拉起，
  否则 12 秒后以**原 argv 完全相同**的方式 `nohup` 兜底重启。Windows 用独立 PowerShell `.ps1`（`Stop-Process` 硬终止 + 12s 端口轮询 +
  `Start-Process` 原 argv 兜底——Windows 无 POSIX 信号，进程为硬终止，会话靠磁盘持久化恢复）。
  客户端在重启期间轮询新进程 PID，新实例就绪后**自动刷新页面**，无需手动刷新。

## 安装

已发布至 npm。推荐直接安装：

```sh
dsh plugin --profile web add @louchi1984/dsh-auto-update
dsh web
```

`dsh plugin` 是 profile 目录里的 pnpm 转发层，因此需要机器上装有 pnpm。也可通过 GitHub 或本地目录安装，适合开发调试。

### Windows

插件已内置 Windows 分支（PowerShell 重启脚本、`npm.cmd`、`taskkill`）。把插件目录传到
Windows 机器后（`dsh-auto-update-win.zip` 或整个目录），在 PowerShell 中：

```powershell
# 1) 解压到任意路径（避免中文/空格），如 D:\plugins\dsh-auto-update
# 2) 依赖（dsh plugin 需要 pnpm；没有 pnpm 时也可直接手动装：
#    cd $env:USERPROFILE\.dsh\profiles\web
#    pnpm add "file:D:\plugins\dsh-auto-update"）
dsh plugin --profile web add "file:D:\plugins\dsh-auto-update"

# 3) 重启 dsh web
```

注意：
- `dsh plugin` 安装的是指向解压目录的 junction——之后更新插件直接替换解压目录里的 `lib/` 文件、重启 dsh 即可，无需重装；
- 版本检查/安装走 Windows 机器自己的 npm 配置（镜像、代理按那台机器设置）；
- Windows 重启为 `Stop-Process` 硬终止 + PowerShell 兜底拉起（无 POSIX 信号），会话靠磁盘持久化恢复；
- 插件只应暴露在 loopback；`--host` 暴露局域网需先加访问认证。

## 配置（Config）

官方契约：`Config` 用 `@deepseek-ai/schemastery` 的 `z.object` 定义，默认值在 schema 中，
可按部署覆盖（在 `cordis.patch.yml` 的 insert 行加 `config`）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `registries` | `[registry.npmjs.org, registry.npmmirror.com]` | 版本检查源，按顺序尝试 |
| `fetchTimeoutMs` | `8000` | 单个 registry 源超时 |
| `checkIntervalMs` | `21600000`（6h） | 自动扫描间隔 |
| `bootCheckDelayMs` | `15000` | 启动后首次扫描延迟 |
| `tickMs` | `5000` | 状态机心跳间隔 |
| `autoRestartDelayMs` | `3000` | 安装成功后自动重启延迟 |
| `dismissMs` | `86400000`（24h） | 「稍后」忽略有效期 |
| `restartGraceMs` | `3000` | 重启脚本杀进程前响应刷出宽限 |
| `respawnWaitMs` | `12000` | 杀完进程等监管方拉起的窗口 |
| `maxTermWaitS` | `15` | SIGTERM 后等待进程退出的秒数 |

## HTTP 路由（本地 webServer，同源访问）

| 路由 | 方法 | 说明 |
|---|---|---|
| `/dsh-update/status` | GET | 当前/最新版本、状态机、安装日志、倒计时 |
| `/dsh-update/check` | POST | 立即扫描一次 |
| `/dsh-update/install` | POST `{tag:"latest"\|"next"}` | 下载并安装 |
| `/dsh-update/dismiss` | POST `{version}` | 「稍后」忽略某个版本 |

状态持久化：`$DSH_HOME/dsh-auto-update.json`；日志：`$DSH_HOME/dsh-auto-update.log`；
重启助手脚本：`$DSH_HOME/dsh-auto-update-restart.sh`（每次重启时重新生成）。

## 安全提示

- 安装与重启端点会以**你的权限**执行 `npm install -g` 并杀掉/拉起 dsh 进程，
  因此该插件默认只应暴露在 loopback（默认绑定 `127.0.0.1:3080`）。
  若你用 `--host` 暴露到局域网，请先加访问认证（参考 dsh-web-auth 类插件）。
- 更新前请在「更新日志」确认 breaking changes —— DSH 是开发者预览版，
  官方声明有破坏性兼容变更。
- 插件本身不做什么魔法：升级通道是官方 npm 包，安装命令透明可见。

## 状态机

```
idle ──check──> checking ──有新版──> update-available ──install──> installing
  ▲                   │                                                     │
  └──< 无新版 <────────┘                                                     ▼
error <──────────── 安装失败                                            installed
  ▲                                                                        │
  └────────────── 触发重启失败 <───────── restarting <──── 倒计时结束/立即重启
```
