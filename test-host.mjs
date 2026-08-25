/**
 * Offline smoke test for dsh-auto-update host half.
 *
 * 覆盖五条路径：发现新版本(update-available) → dismiss → 已是最新(idle) → 检查失败(error)
 * → 官方源不可用、镜像 fallback 兜底。
 * 不调用 install/restart（它们会 spawn 真实进程）。
 *
 * 关键修正（相对旧版）：
 *  - DSH_HOME 隔离到 /tmp，绝不读写真实 ~/.dsh 状态；
 *  - process.argv[1] 指向真实存在的 fixture（bin.js + 同级 package.json），
 *    让 currentVersion() 返回真实版本号 —— 旧版指向不存在的路径返回 "unknown"，
 *    导致 compareVer 走字符串兜底，永远进不了 update-available，测试是"假绿"。
 */
import assert from "node:assert";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const HOME = "/tmp/dsh-update-test/home";
const LIB = "/tmp/dsh-update-test/lib";
const PACKAGE = "/tmp/dsh-update-test/package";
process.env.DSH_HOME = HOME;
rmSync("/tmp/dsh-update-test", { recursive: true, force: true }); // 上一轮残留不污染
mkdirSync(LIB, { recursive: true });
mkdirSync(PACKAGE, { recursive: true });

// currentVersion()：realpath(argv[1]) 的上一级取 package.json
const FIXTURE = join(LIB, "bin.js");
writeFileSync(FIXTURE, "#!/usr/bin/env node\n");
process.argv[1] = FIXTURE;
function setCurrent(v) {
  writeFileSync(join(LIB, "..", "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh", version: v }));
}

// 把生产 host 文件逐字复制到 /tmp，仅以最小 schemastery stub 替换其唯一外部依赖。
// 这样不需要安装依赖，也不会写入真实 ~/.dsh；其余代码仍是被测生产代码。
const SOURCE = readFileSync(new URL("./lib/index.js", import.meta.url), "utf8");
const HOST = join(PACKAGE, "index.js");
writeFileSync(join(PACKAGE, "package.json"), JSON.stringify({ type: "module" }));
writeFileSync(HOST, SOURCE.replace('import z from "@deepseek-ai/schemastery";', 'const z = { object: (shape) => shape, array: () => ({ default: () => ({}) }), string: () => ({ default: () => ({}) }), number: () => ({ min: () => ({ default: () => ({}) }) }) };'));
async function loadHost() {
  return import(pathToFileURL(HOST).href + "?run=" + Math.random());
}

// 动态 import：必须先设好 DSH_HOME，模块体（含 readState）在 import 时执行
let { apply } = await loadHost();

function makeCtx() {
  const routes = [];
  const cleanups = [];
  return {
    routes,
    dispose() {
      for (const cleanup of cleanups.splice(0).reverse()) cleanup?.();
    },
    ctx: {
      effect: (fn) => cleanups.push(fn()),
      webServer: {
        register: (route) => {
          routes.push(route);
          return () => {};
        },
        port: 3080,
      },
    },
  };
}
let { routes, ctx, dispose } = makeCtx();

// registry stub（按 URL 控制故障，模拟官方源被墙/断网）
let registry = {
  "dist-tags": { latest: "0.1.0-rc.7", next: "0.1.0-rc.8" },
  time: { "0.1.0-rc.8": "2026-08-19T15:41:29.655Z" },
};
let officialFail = false; // 官方源抛错（模拟超时/被墙），镜像仍可用
let allFail = false; // 所有源都挂（模拟断网）
const fetchCalls = [];
globalThis.fetch = async (url) => {
  fetchCalls.push(url);
  if (allFail) throw new Error("ECONNREFUSED");
  if (officialFail && url.includes("registry.npmjs.org")) throw new Error("ETIMEDOUT");
  return { ok: true, json: async () => registry };
};

function makeRes() {
  let body = null;
  return {
    body: () => body,
    writeHead() {},
    end(b) {
      body = typeof b === "string" ? JSON.parse(b) : b;
    },
  };
}

/** 可迭代一次的假请求体（dismiss 用） */
function fakeReqWith(body) {
  let sent = false;
  return {
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          if (!sent) {
            sent = true;
            return { done: false, value: Buffer.from(JSON.stringify(body)) };
          }
          return { done: true, value: undefined };
        },
      };
    },
  };
}

apply(ctx);
const byPath = Object.fromEntries(routes.map((r) => [r.path, r]));
const status = async () => {
  const res = makeRes();
  await byPath["/dsh-update/status"].handler({}, res);
  return res.body();
};

// ── 场景 1：rc.7 运行中，registry 有 rc.8 → update-available，target = rc.8 (next) ──
setCurrent("0.1.0-rc.7");
const res1 = makeRes();
await byPath["/dsh-update/check"].handler({}, res1);
const s1 = res1.body();
assert.equal(s1.status, "update-available", "发现新版本时应进入 update-available");
assert.equal(s1.current, "0.1.0-rc.7");
assert.equal(s1.target.version, "0.1.0-rc.8", "应选中更高的 next 版本");
assert.equal(s1.target.tag, "next");
assert.ok(s1.changelogUrl.includes("0.1.0-rc.8"), "changelogUrl 应指向目标版本");
console.log("[1] update-available OK: current =", s1.current, "→ target =", s1.target.version, "(" + s1.target.tag + ")");

// ── 场景 2：dismiss 目标版本 → dismissed=true，状态保持 update-available ──
const res2 = makeRes();
await byPath["/dsh-update/dismiss"].handler(fakeReqWith({ version: "0.1.0-rc.8" }), res2);
const s2 = await status();
assert.equal(s2.dismissed, true, "dismiss 后 dismissed 应为 true");
assert.equal(s2.status, "update-available", "dismiss 不改变状态机");
console.log("[2] dismiss OK: dismissed =", s2.dismissed, "| status =", s2.status);

// ── 场景 3：当前版本已升到 rc.8（模拟上次安装其实成功）→ 检查后回到 idle ──
setCurrent("0.1.0-rc.8");
const res3 = makeRes();
await byPath["/dsh-update/check"].handler({}, res3);
const s3 = res3.body();
assert.equal(s3.status, "idle", "已是最新应回到 idle");
assert.equal(s3.target, null);
assert.equal(s3.dismissed, false, "无目标时 dismissed 应为 false");
console.log("[3] already-latest OK: status =", s3.status);

// ── 场景 4：所有 registry 源不可达 → error 态，且不会卡在 checking ──
allFail = true;
const res4 = makeRes();
await byPath["/dsh-update/check"].handler({}, res4);
const s4 = res4.body();
assert.equal(s4.status, "error", "检查失败应进入 error");
assert.ok(s4.error && s4.error.includes("ECONNREFUSED"), "error 应包含原因");
console.log("[4] check-failure OK: status =", s4.status, "| error =", s4.error);

// ── 场景 5：官方源不可用 → fallback 到镜像，仍能发现新版本 ──
allFail = false;
officialFail = true;
setCurrent("0.1.0-rc.7"); // 回到旧版本，让镜像上的 rc.8 成为目标
fetchCalls.length = 0;
const res5 = makeRes();
await byPath["/dsh-update/check"].handler({}, res5);
const s5 = res5.body();
assert.equal(s5.status, "update-available", "官方源失败时镜像 fallback 应仍发现新版本");
assert.equal(s5.target.version, "0.1.0-rc.8");
assert.ok(s5.registrySource.includes("npmmirror.com"), "registrySource 应记录实际使用的镜像源");
assert.ok(fetchCalls[0].includes("registry.npmjs.org") && fetchCalls[1].includes("npmmirror.com"), "应先试官方源、再试镜像");
console.log("[5] mirror-fallback OK: source =", s5.registrySource);
dispose();


// ── 场景 6：手动检查必须等所有 registry 尝试完成，不能 8 秒后回 checking ──
// 第一源 4.2 秒失败、第二源 4.2 秒成功；旧实现固定 8 秒 race 会错误返回 checking。
officialFail = false;
allFail = false;
globalThis.fetch = async (url) => {
  await new Promise((resolve) => setTimeout(resolve, 4200));
  if (url.includes("registry.npmjs.org")) throw new Error("ETIMEDOUT");
  return { ok: true, json: async () => registry };
};
({ apply } = await loadHost());
({ routes, ctx, dispose } = makeCtx());
apply(ctx, { registries: ["https://registry.npmjs.org/test", "https://registry.npmmirror.com/test"] });
const slowRoutes = Object.fromEntries(routes.map((r) => [r.path, r]));
const res6 = makeRes();
await slowRoutes["/dsh-update/check"].handler({}, res6);
const s6 = res6.body();
assert.notEqual(s6.status, "checking", "手动检查必须返回最终状态，不能超时后返回 checking");
assert.equal(s6.status, "update-available", "第二 registry 成功后应返回检查结果");
console.log("[6] check waits for final result OK: status =", s6.status);
dispose();

// ── 场景 7：重启后保留已确认的版本与忽略记录；仅清理中断的瞬态状态 ──
writeFileSync(join(HOME, "dsh-auto-update.json"), JSON.stringify({
  status: "idle",
  current: "0.1.0-rc.8",
  latest: "0.1.0-rc.9",
  next: "0.1.0-rc.9",
  target: { tag: "next", version: "0.1.0-rc.9" },
  lastCheck: Date.now(),
  dismissed: { "0.1.0-rc.9": Date.now() },
}));
({ apply } = await loadHost());
({ routes, ctx, dispose } = makeCtx());
apply(ctx);
const persistedRoutes = Object.fromEntries(routes.map((r) => [r.path, r]));
const persistedRes = makeRes();
await persistedRoutes["/dsh-update/status"].handler({}, persistedRes);
const persisted = persistedRes.body();
assert.equal(persisted.current, "0.1.0-rc.8", "重启后应先显示已保存的当前版本");
assert.equal(persisted.latest, "0.1.0-rc.9", "重启后应保留已保存的最新版本");
assert.ok(persisted.dismissed, "重启后应保留已关闭提示记录");
console.log("[7] persisted display state OK: current =", persisted.current);
dispose();

// ── 场景 8：安装取消在 POSIX 直启 npm；客户端在安装阶段每秒刷新 ──
const clientSource = readFileSync(new URL("./lib/client.js", import.meta.url), "utf8");
assert.match(SOURCE, /shell:\s*IS_WIN/, "POSIX 不应通过 shell 包装 npm，取消才能直接终止 npm");
assert.match(clientSource, /const refreshMs = s && \(s\.status === "installing" \|\| s\.status === "installed" \|\| s\.status === "restarting"\) \? 1e3 : 15e3/, "安装/重启阶段必须每秒轮询状态");
console.log("[8] install-cancel and reload polling contracts OK");

console.log("OK: host half smoke test passed（5/5 路径）");
