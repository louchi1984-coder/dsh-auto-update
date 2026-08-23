/**
 * dsh-auto-update — host half.
 *
 * 自动更新：定时扫描 npm registry 上的 @deepseek-ai/dsh 新版本（latest / next
 * 两个通道），通过 webServer 路由向客户端暴露状态；客户端确认后执行
 * `npm install -g @deepseek-ai/dsh@<tag>`，安装成功后再触发进程重启。
 *
 * 重启策略（双平台）：
 *  POSIX（macOS/Linux）：生成独立 /bin/sh 脚本（detached，脱离本进程生命周期）——
 *    sleep 3s（让 HTTP 响应先刷出去）→ SIGTERM 优雅关停旧进程（boot 的 SIGTERM 处理器
 *    走 fiber.dispose，会话持久化在磁盘自动恢复）→ 等端口就绪（原生壳看门狗自动拉起）→
 *    12s 没人拉起则用原 argv 自行 nohup 重启。
 *  Windows：生成独立 PowerShell .ps1（detached）——Start-Sleep 3s → Stop-Process 硬终止
 *    （Windows 无 POSIX 信号）→ Invoke-WebRequest 轮询端口 12s → 兜底 Start-Process 原 argv。
 *    进程为硬终止，会话靠磁盘持久化在重启后恢复。
 *
 * 状态持久化在 $DSH_HOME/dsh-auto-update.json；日志在 $DSH_HOME/dsh-auto-update.log。
 */
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, realpathSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import z from "@deepseek-ai/schemastery";

export const name = "dsh-auto-update";
export const inject = ["webServer"];

const PKG = "@deepseek-ai/dsh";
// 版本检查源：优先 npm 官方仓库，失败/超时自动 fallback 到国内镜像（registry.npmjs.org
// 国内可直连但偶发慢/超时；安装始终走 npm 自身配置的 registry，与本列表无关）
const DEFAULT_REGISTRIES = [
  `https://registry.npmjs.org/${PKG}`,
  `https://registry.npmmirror.com/${PKG}`,
];
const RELEASES_URL = "https://github.com/deepseek-ai/deepseek-harness/releases/tag/";
// Windows 版差异：npm 要用 npm.cmd 全名、重启脚本用 PowerShell(.ps1)、
// 终止进程树用 taskkill /T、PATH 分隔符是 ";"（无 POSIX 信号，进程为硬终止）。
// DSH_AUTO_UPDATE_FORCE_WIN=1 可强制走 Windows 分支（在非 Windows 上调试/测试用）。
const IS_WIN = process.env.DSH_AUTO_UPDATE_FORCE_WIN === "1" || process.platform === "win32";

/**
 * 官方契约：Config 用 @deepseek-ai/schemastery 的 z 定义，默认值放 schema。
 * 任何按部署调整的值都收敛到这里，而不是散落的源码常量（可以在
 * cordis.patch.yml 的 insert 行里给 config 覆盖）。
 */
export const Config = z.object({
  /** 版本检查源，按顺序尝试，失败/超时自动 fallback 到下一个 */
  registries: z.array(z.string()).default(DEFAULT_REGISTRIES),
  /** 单个 registry 源超时（ms） */
  fetchTimeoutMs: z.number().min(1000).default(8 * 1000),
  /** 自动扫描间隔（ms），默认 6 小时 */
  checkIntervalMs: z.number().min(60 * 1000).default(6 * 60 * 60 * 1000),
  /** 启动后首次扫描延迟（ms） */
  bootCheckDelayMs: z.number().min(0).default(15 * 1000),
  /** 状态机心跳间隔（ms） */
  tickMs: z.number().min(1000).default(5 * 1000),
  /** 安装成功后自动重启延迟（ms） */
  autoRestartDelayMs: z.number().min(0).default(3000),
  /** 「稍后」忽略的有效期（ms），默认 24 小时 */
  dismissMs: z.number().min(0).default(24 * 60 * 60 * 1000),
  /** 重启脚本杀进程前的响应刷出宽限（ms） */
  restartGraceMs: z.number().min(0).default(3000),
  /** 杀完进程后等待监管方拉起的窗口（ms） */
  respawnWaitMs: z.number().min(0).default(12 * 1000),
  /** SIGTERM 后等待进程退出的秒数 */
  maxTermWaitS: z.number().min(1).default(15),
});

/** 运行时生效配置（apply 时从 Config 解析结果填充；未填充时与 schema 默认一致） */
const cfg = {
  registries: DEFAULT_REGISTRIES,
  fetchTimeoutMs: 8 * 1000,
  checkIntervalMs: 6 * 60 * 60 * 1000,
  bootCheckDelayMs: 15 * 1000,
  tickMs: 5 * 1000,
  autoRestartDelayMs: 3000,
  dismissMs: 24 * 60 * 60 * 1000,
  restartGraceMs: 3000,
  respawnWaitMs: 12 * 1000,
  maxTermWaitS: 15,
};

/* #region 基础工具 */

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), ".dsh");
}
function stateFile() {
  return join(dshHome(), "dsh-auto-update.json");
}
function logFile() {
  return join(dshHome(), "dsh-auto-update.log");
}
function readState() {
  try {
    return JSON.parse(readFileSync(stateFile(), "utf8"));
  } catch {
    return {};
  }
}
function writeState() {
  try {
    mkdirSync(dshHome(), { recursive: true });
    writeFileSync(stateFile(), JSON.stringify(state, null, 2));
  } catch (err) {
    log("writeState failed:", err.message);
  }
}
function log(...parts) {
  try {
    mkdirSync(dshHome(), { recursive: true });
    appendFileSync(logFile(), `[${new Date().toISOString()}] ${parts.join(" ")}\n`);
  } catch {
    /* 日志写不进去不致命 */
  }
}
/** shell 单引号转义 */
function shq(s) {
  return "'" + String(s).replace(/'/g, `'\\''`) + "'";
}
/** PowerShell 单引号转义（单引号内单引号翻倍为两个） */
function pshq(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}
function cap(s, n) {
  return String(s == null ? "" : s).slice(-n);
}
/* #endregion */

/* #region 版本工具 */

/** 从 dsh 启动入口向上寻找 @deepseek-ai/dsh 的 package.json。 */
function currentVersion() {
  try {
    const entry = process.argv[1];
    if (entry && existsSync(entry)) {
      let dir = dirname(realpathSync(entry));
      for (let i = 0; i < 6; i++) {
        const pkg = join(dir, "package.json");
        if (existsSync(pkg)) {
          const data = JSON.parse(readFileSync(pkg, "utf8"));
          if (data.name === PKG && typeof data.version === "string" && data.version) return data.version;
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    }
    const prefix = dirname(dirname(process.execPath));
    const pkg = join(prefix, "lib", "node_modules", PKG, "package.json");
    if (existsSync(pkg)) {
      const data = JSON.parse(readFileSync(pkg, "utf8"));
      if (typeof data.version === "string" && data.version) return data.version;
    }
  } catch (err) {
    log("currentVersion fallback:", err.message);
  }
  return "unknown";
}

function parseVer(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(v).trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] || null };
}
/** 返回 a - b 的符号（-1 / 0 / 1） */
function compareVer(a, b) {
  const A = parseVer(a);
  const B = parseVer(b);
  if (!A || !B) return String(a) === String(b) ? 0 : String(a) < String(b) ? -1 : 1;
  for (const k of ["major", "minor", "patch"]) {
    if (A[k] !== B[k]) return A[k] - B[k];
  }
  if (!A.pre && !B.pre) return 0;
  if (!A.pre) return 1; // 正式版 > 预发布
  if (!B.pre) return -1;
  const ap = A.pre.split(".");
  const bp = B.pre.split(".");
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const x = ap[i];
    const y = bp[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x) ? +x : x;
    const yn = /^\d+$/.test(y) ? +y : y;
    if (typeof xn === "number" && typeof yn === "number") {
      if (xn !== yn) return xn - yn;
    } else if (String(xn) !== String(yn)) {
      return String(xn) < String(yn) ? -1 : 1;
    }
  }
  return 0;
}
/* #endregion */

/* #region 状态 */

const state = {
  ...readState(),
  status: "idle", // idle | checking | update-available | installing | installed | restarting | error
  current: "unknown",
  latest: null,
  next: null,
  publishedAt: null,
  target: null, // { tag, version }
  lastCheck: null,
  registrySource: null, // 最近一次检查实际使用的 registry URL
  error: null,
  installLog: null,
  installedVersion: null,
  restartAt: null, // 倒计时重启的时间戳
  restarting: false,
  dismissed: {}, // { "<version>": timestamp }
};

// 自愈（由上方默认值完成，无需额外代码）：上次会话崩溃在 安装中/已安装/重启中 时，
// 这里的 status/restartAt/restarting/error/installedVersion/installLog 默认值已把
// 状态重置为干净起点（readState 的旧值会被逐一覆盖），启动后的首次扫描重新评估 ——
// 若那次 npm install 其实已完成，扫描会发现当前版本已等于目标 → idle。

/** 当前正在跑的 npm install 子进程句柄（用于取消）与实时输出缓冲 */
let installChild = null;
let installBuffer = "";
/* #endregion */

/* #region 扫描 */

async function fetchRegistry() {
  let lastErr = null;
  for (const url of cfg.registries) {
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(cfg.fetchTimeoutMs),
      });
      if (!res.ok) throw new Error(`npm registry HTTP ${res.status}`);
      const data = await res.json();
      const latest = (data["dist-tags"] || {}).latest || null;
      const next = (data["dist-tags"] || {}).next || null;
      const publishedAt = (data.time && latest && data.time[latest]) || null;
      return { latest, next, publishedAt, source: url };
    } catch (err) {
      lastErr = err;
      log("fetchRegistry 源不可用，尝试下一个:", url, "→", err.message);
    }
  }
  throw lastErr || new Error("所有 registry 源均不可达");
}

async function checkNow() {
  if (state.status === "checking" || state.status === "installing") return;
  state.status = "checking";
  state.error = null;
  writeState();
  try {
    const reg = await fetchRegistry();
    const cur = currentVersion();
    const candidates = [
      { tag: "latest", version: reg.latest },
      { tag: "next", version: reg.next },
    ].filter((c) => c.version);
    let target = null;
    for (const c of candidates) {
      if (compareVer(c.version, cur) > 0 && (!target || compareVer(c.version, target.version) > 0)) {
        target = c;
      }
    }
    state.current = cur;
    state.latest = reg.latest;
    state.next = reg.next;
    state.publishedAt = reg.publishedAt;
    state.registrySource = reg.source;
    state.lastCheck = Date.now();
    state.target = target;
    if (target) {
      state.status = "update-available";
      log("发现新版本:", target.version, `(${target.tag})`, "当前:", cur, "来源:", reg.source);
    } else {
      state.status = "idle";
      log("已是最新，当前:", cur, "latest:", reg.latest, "next:", reg.next, "来源:", reg.source);
    }
  } catch (err) {
    state.status = "error";
    state.error = "检查更新失败：" + (err && err.message ? err.message : String(err));
    log("check failed:", state.error);
  }
  writeState();
}
/* #endregion */

/* #region 安装 */

function npmPath() {
  // 优先 PATH 上的 npm；Windows 上 spawn 必须用 .cmd 全名，否则 ENOENT/EINVAL
  return IS_WIN ? "npm.cmd" : "npm";
}

function installTag(tag) {
  return new Promise((resolve) => {
    if (state.status === "installing") {
      resolve();
      return;
    }
    state.status = "installing";
    state.installLog = "";
    state.error = null;
    writeState();
    const cacheDir = join(dshHome(), ".npm-cache");
    mkdirSync(cacheDir, { recursive: true });
    const env = { ...process.env };
    const nodeDir = dirname(process.execPath);
    env.PATH = nodeDir + (env.PATH ? (IS_WIN ? ";" : ":") + env.PATH : "");
    log("npm install -g", `${PKG}@${tag}`, "--cache", cacheDir);
    installBuffer = "";
    // Windows 注意：.cmd 必须带 shell:true，否则 spawn 同步抛 EINVAL 导致
    // 安装直接崩溃（实测：无 shell 时进程崩溃、npm 从未执行、缓存全空）。
    const child = spawn(npmPath(), ["install", "-g", `${PKG}@${tag}`, "--cache", cacheDir, "--no-fund", "--no-audit"], {
      env,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    installChild = child;
    const onData = (d) => {
      installBuffer += String(d);
      if (installBuffer.length > 4000) installBuffer = installBuffer.slice(-4000);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (err) => {
      installChild = null;
      state.status = "error";
      state.error = "无法启动 npm：" + err.message;
      state.installLog = cap(installBuffer, 2000);
      writeState();
      log("install spawn error:", err.message);
      resolve();
    });
    child.on("close", (code) => {
      installChild = null;
      state.installLog = cap(installBuffer, 2000);
      if (code === 0) {
        state.status = "installed";
        // 存真实版本号而不是通道名（"latest"/"next"），客户端直接展示 "已安装 vX.Y.Z"
        state.installedVersion = (state.target && state.target.version) || tag;
        state.restartAt = Date.now() + cfg.autoRestartDelayMs;
        log("安装成功:", state.installedVersion, "(", tag, ") 将在", cfg.autoRestartDelayMs / 1000, "秒后自动重启");
      } else {
        state.status = "error";
        state.error = `npm 安装失败 (exit ${code})`;
        log("npm install exit", code, "tail:", cap(installBuffer, 800));
      }
      writeState();
      resolve();
    });
  });
}

/** 取消进行中的安装（杀掉 npm 子进程） */
function cancelInstall() {
  if (installChild) {
    try {
      if (IS_WIN) {
        // Windows 上 npm.cmd 只是壳，直接 kill 只杀壳；taskkill /T 连 npm 的子进程树一起终止
        spawn("taskkill", ["/PID", String(installChild.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        installChild.kill("SIGTERM");
      }
    } catch {
      /* ignore */
    }
    state.status = "error";
    state.error = "安装已取消";
    state.installLog = cap(installBuffer, 2000);
    writeState();
    log("install cancelled by user");
    return true;
  }
  return false;
}
/* #endregion */

/* #region 重启 */

function buildRestartScript(port) {
  return IS_WIN ? buildRestartScriptWin(port) : buildRestartScriptPosix(port);
}

/** POSIX（macOS/Linux）：/bin/sh detached 脚本，SIGTERM 优雅关停 */
function buildRestartScriptPosix(port) {
  const pid = process.pid;
  const relaunch = [process.execPath, process.argv[1], ...process.argv.slice(2)];
  const relaunchStr = relaunch.map(shq).join(" ");
  const cwd = process.cwd();
  const healthUrl = `http://127.0.0.1:${port}/`;
  const lg = shq(logFile());
  return `#!/bin/sh
# generated by dsh-auto-update — do not edit by hand
# 1) 等 3 秒让 HTTP 响应刷出  2) 优雅关停旧进程  3) 等监管方拉起  4) 兜底自行重启
sleep ${Math.round(cfg.restartGraceMs / 1000)}
kill -TERM ${pid} 2>/dev/null
i=0
while [ $i -lt ${cfg.maxTermWaitS} ]; do
  kill -0 ${pid} 2>/dev/null || break
  i=$((i+1)); sleep 1
done
kill -9 ${pid} 2>/dev/null
j=0
while [ $j -lt ${Math.round(cfg.respawnWaitMs / 1000)} ]; do
  if curl -s -o /dev/null -m 1 ${shq(healthUrl)} 2>/dev/null; then
    echo "[dsh-auto-update] 监管方已拉起新实例，无需自行重启" >> ${lg}
    exit 0
  fi
  j=$((j+1)); sleep 1
done
cd ${shq(cwd)} 2>/dev/null || cd "$HOME"
echo "[dsh-auto-update] 无监管方，自行拉起 dsh web" >> ${lg}
nohup ${relaunchStr} >> ${lg} 2>&1 &
exit 0
`;
}

/** Windows：PowerShell .ps1 detached 脚本（无 POSIX 信号 → Stop-Process 硬终止） */
function buildRestartScriptWin(port) {
  const pid = process.pid;
  const relaunch = [process.execPath, process.argv[1], ...process.argv.slice(2)];
  // Start-Process 的 -ArgumentList 是单个字符串，内部用双引号包每个参数以保留空格
  const relaunchArgs = relaunch.map((a) => '"' + String(a).replace(/"/g, '""') + '"').join(" ");
  const cwd = process.cwd();
  const healthUrl = `http://127.0.0.1:${port}/`;
  const lg = pshq(logFile());
  return `# generated by dsh-auto-update — do not edit by hand
# 1) 等 3 秒让 HTTP 响应刷出  2) 终止旧进程  3) 等监管方拉起  4) 兜底自行重启
# 注意：Windows 无 POSIX 信号，进程为硬终止；dsh 会话持久化在磁盘，重启后自动恢复
Start-Sleep -Seconds ${Math.round(cfg.restartGraceMs / 1000)}
Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue
$i = 0
while ($i -lt ${cfg.maxTermWaitS}) {
  if (-not (Get-Process -Id ${pid} -ErrorAction SilentlyContinue)) { break }
  $i++; Start-Sleep -Seconds 1
}
$deadline = (Get-Date).AddSeconds(${Math.round(cfg.respawnWaitMs / 1000)})
while ((Get-Date) -lt $deadline) {
  try {
    $r = Invoke-WebRequest -Uri ${pshq(healthUrl)} -UseBasicParsing -TimeoutSec 1
    if ($r.StatusCode -eq 200) {
      Add-Content -Path ${lg} -Value "[dsh-auto-update] 监管方已拉起新实例，无需自行重启"
      exit 0
    }
  } catch { }
  Start-Sleep -Seconds 1
}
Set-Location ${pshq(cwd)} -ErrorAction SilentlyContinue
Add-Content -Path ${lg} -Value "[dsh-auto-update] 无监管方，自行拉起 dsh web"
Start-Process -FilePath ${pshq(relaunch[0])} -ArgumentList ${pshq(relaunchArgs)} -WindowStyle Hidden
exit 0
`;
}

function triggerRestart() {
  if (state.restarting) return;
  state.restarting = true;
  state.status = "restarting";
  state.restartAt = null;
  writeState();
  try {
    const port = ctx.webServer && ctx.webServer.port ? ctx.webServer.port : 3080;
    const script = buildRestartScript(port);
    const scriptPath = join(dshHome(), IS_WIN ? "dsh-auto-update-restart.ps1" : "dsh-auto-update-restart.sh");
    mkdirSync(dshHome(), { recursive: true });
    writeFileSync(scriptPath, script, "utf8");
    if (!IS_WIN) chmodSync(scriptPath, 0o755);
    log("触发重启，helper:", scriptPath);
    // Windows 注意：不要用 detached:true —— 实测在该环境下 detached 拉起的
    // PowerShell 进程存在但不会执行脚本（脚本不跑、进程空转）。Windows 的
    // 子进程本来就不随父进程死亡，去掉 detached 后脚本仍能独立完成
    // 「杀旧进程 → 等监管方拉起 → 12s 兜底重启」，且能通过 error 事件捕获问题。
    const child = IS_WIN
      ? spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath], {
          stdio: "ignore",
          windowsHide: true,
        })
      : spawn("/bin/sh", [scriptPath], { detached: true, stdio: "ignore" });
    child.on("error", (err) => log("restart helper spawn error:", err.message));
    child.unref();
  } catch (err) {
    state.restarting = false;
    state.status = "error";
    state.error = "触发重启失败：" + err.message;
    writeState();
    log("triggerRestart failed:", err.message);
  }
}
/* #endregion */

/* #region HTTP 路由 */

function publicStatus() {
  const dismissedAt = state.target ? state.dismissed[state.target.version] : undefined;
  const dismissed = dismissedAt ? Date.now() - dismissedAt < cfg.dismissMs : false;
  return {
    ok: true,
    current: state.current,
    latest: state.latest,
    next: state.next,
    publishedAt: state.publishedAt,
    target: state.target,
    status: state.status,
    error: state.error,
    lastCheck: state.lastCheck,
    registrySource: state.registrySource,
    installLog: state.installLog,
    installedVersion: state.installedVersion,
    restartAt: state.restartAt,
    restartCountdownMs: state.restartAt ? Math.max(0, state.restartAt - Date.now()) : null,
    dismissed,
    changelogUrl: state.target ? RELEASES_URL + "dsh-v" + state.target.version : null,
    pid: process.pid,
  };
}

let ctx = null;

function sendJson(res, body, status = 200) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(payload);
}

/** 解析 JSON 请求体；非法 JSON 返回 null（路由据此回 400） */
async function readJsonBody(req) {
  try {
    const chunks = [];
    for await (const ch of req) chunks.push(ch);
    const text = Buffer.concat(chunks).toString("utf8").trim();
    return text ? JSON.parse(text) : {};
  } catch {
    return null;
  }
}

export function apply(c, config) {
  ctx = c;
  // 填充运行时配置（Config schema 已带默认值；部署可经 patch config 覆盖）
  for (const k of Object.keys(cfg)) {
    if (config && config[k] !== undefined) cfg[k] = config[k];
  }
  log("dsh-auto-update apply, config:", JSON.stringify(cfg));

  // 官方契约：长生命周期资源用 ctx.effect 注册，disable 时自动清理
  ctx.effect(() =>
    ctx.webServer.register({
      kind: "exact",
      path: "/dsh-update/status",
      handler: async (req, res) => sendJson(res, publicStatus()),
    }),
  );

  ctx.effect(() =>
    ctx.webServer.register({
      kind: "exact",
      path: "/dsh-update/check",
      handler: async (req, res) => {
        // 等检查完成（最多 8 秒）再返回最终状态：客户端一次拿到结果，
        // 不会先看到 checking 中间态导致入口闪烁/消失
        try {
          await Promise.race([
            checkNow().catch((err) => log("checkNow:", err.message)),
            new Promise((r) => setTimeout(r, 8000)),
          ]);
          sendJson(res, publicStatus());
        } catch (err) {
          sendJson(res, { ok: false, error: "检查失败：" + (err && err.message ? err.message : String(err)) }, 500);
        }
      },
    }),
  );

  ctx.effect(() =>
    ctx.webServer.register({
      kind: "exact",
      path: "/dsh-update/install",
      handler: async (req, res) => {
        const body = await readJsonBody(req);
        if (body === null) {
          sendJson(res, { ok: false, error: "请求体必须是合法 JSON" }, 400);
          return;
        }
        let tag = "latest";
        if (body && (body.tag === "latest" || body.tag === "next")) tag = body.tag;
        try {
          installTag(tag);
          sendJson(res, publicStatus()); // status 已同步切到 installing
        } catch (err) {
          log("install route error:", err.message);
          state.status = "error";
          state.error = "安装失败：" + (err && err.message ? err.message : String(err));
          writeState();
          sendJson(res, { ok: false, error: state.error }, 500);
        }
      },
    }),
  );

  ctx.effect(() =>
    ctx.webServer.register({
      kind: "exact",
      path: "/dsh-update/cancel-install",
      handler: async (req, res) => {
        try {
          cancelInstall();
          sendJson(res, publicStatus());
        } catch (err) {
          log("cancel route error:", err.message);
          sendJson(res, { ok: false, error: "取消失败：" + err.message }, 500);
        }
      },
    }),
  );

  ctx.effect(() =>
    ctx.webServer.register({
      kind: "exact",
      path: "/dsh-update/restart",
      handler: async (req, res) => {
        // 直接同步触发：脚本本身 sleep 后才杀进程，响应来得及先刷出去
        try {
          triggerRestart();
          sendJson(res, publicStatus()); // status = restarting
        } catch (err) {
          log("restart route:", err.message);
          sendJson(res, { ok: false, error: "触发重启失败：" + err.message }, 500);
        }
      },
    }),
  );

  ctx.effect(() =>
    ctx.webServer.register({
      kind: "exact",
      path: "/dsh-update/dismiss",
      handler: async (req, res) => {
        const body = await readJsonBody(req);
        if (body === null) {
          sendJson(res, { ok: false, error: "请求体必须是合法 JSON" }, 400);
          return;
        }
        if (body && body.version) {
          state.dismissed[body.version] = Date.now();
          writeState();
        }
        sendJson(res, publicStatus()); // 返回最新状态，客户端立即隐藏横幅
      },
    }),
  );

  // 启动后延迟做首次扫描
  ctx.effect(() => {
    const bootTimer = setTimeout(() => {
      checkNow().catch((err) => log("boot check:", err.message));
    }, cfg.bootCheckDelayMs);
    return () => clearTimeout(bootTimer);
  });

  // 心跳：安装实时日志 + 重启倒计时 + 定期扫描
  ctx.effect(() => {
    const tick = setInterval(() => {
      if (state.status === "installing" && installBuffer) {
        state.installLog = cap(installBuffer, 2000); // 实时进度，写入 state 供客户端轮询
        writeState();
      }
      if (state.status === "installed" && state.restartAt && Date.now() >= state.restartAt) {
        log("倒计时结束，自动重启");
        triggerRestart();
      }
      const last = state.lastCheck || 0;
      if (Date.now() - last >= cfg.checkIntervalMs && state.status !== "checking" && state.status !== "installing" && !state.restarting) {
        checkNow().catch((err) => log("tick check:", err.message));
      }
    }, cfg.tickMs);
    return () => clearInterval(tick);
  });
}
