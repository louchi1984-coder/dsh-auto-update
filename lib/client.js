window.__ModuleLoader__.load({
	id: "@louchi1984/dsh-auto-update",
	factory: (require) => {
		var exports = { exports: {} }.exports;
		//#region src/client.js
		/*!
		* dsh-auto-update — client half
		*
		* 设计（与「我的专属界面」一致的视觉语言：品牌蓝渐变 + 柔和投影 + 圆角 + 状态胶囊）：
		*
		*  · 左下角侧边栏底部：常驻圆形图标按钮（与设置/会话图标同一视觉重量，不突显）。
		*    - 有新版：弱化下载图标 + 右上角琥珀色呼吸点（仅一个小点作提示）；
		*      点击展开右上角详情卡片（不再误触安装）。
		*    - 已是最新：对勾 ✓（状态健康）；点击卡片可手动「重新检查」或打开官方更新日志。
		*    - 安装中 / 重启中：旋转 spinner；已最新（含安装完成后、重启生效前）：对勾 ✓；
		*      异常：警示图标 + 红点；有新版：下载箭头 + 琥珀点（「稍后」后隐藏）。
		*  · 自动刷新：安装完成重启后，浏览器不会自己重连 —— 客户端轮询新进程 PID，
		*    一旦新实例就绪立即自动 reload 页面，无需手动刷新。
		*  · 右上角详情卡片：标题/描述 + 版本对比胶囊 + 安装进度条 + 可折叠 npm 日志 + 平面按钮
		*    （卡片内不重复放状态图标，状态由入口小点 + 标题文字表达）。安装/重启/异常时自动
		*    弹出，可手动收起；点侧边栏图标随时重新唤出。
		*/
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let React = require("react");
		const h = React.createElement;
		const cssId = "@louchi1984/dsh-auto-update/widget.css";
		const CSS = `
:root{color-scheme:light dark}
.dshu{--bd:var(--dsw-alias-border-l2,rgba(0,0,0,.1));--bd2:var(--dsw-alias-border-l3,rgba(0,0,0,.16));--bg:var(--dsw-alias-bg-base,#fff);--bg2:var(--dsw-alias-bg-layer-2,#fff);--ink:var(--dsw-alias-label-primary,#111);--muted:var(--dsw-alias-label-secondary,#555);--faint:var(--dsw-alias-label-tertiary,#888);--accent:var(--dsw-alias-state-business-primary,#4176e6);--warn:var(--dsw-alias-state-warn-label,#dd8629);--ok:var(--dsw-alias-state-success-primary,#22c55e);--danger:var(--dsw-alias-state-error-primary,#ec1313);--hover:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));font-family:ui-sans-serif,system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:var(--ink)}
.dshu *{box-sizing:border-box}
.dshu button{font:inherit;color:inherit}
/* ── 右上角详情卡片 ─────────────────────────────── */
.dshu .card{position:fixed;top:16px;right:16px;z-index:190;width:min(380px,calc(100vw - 32px));background:var(--bg2);border:1px solid var(--bd2);border-radius:16px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 8px 16px rgba(0,0,0,.06),0 24px 48px rgba(0,0,0,.14);padding:18px 18px 16px;display:grid;gap:12px;animation:dshu-card-in .28s var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1))}
@keyframes dshu-card-in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
.dshu .top{display:flex;align-items:flex-start;gap:8px}
.dshu .titles{flex:1;min-width:0}
.dshu .title{font-size:14.5px;font-weight:600;line-height:1.4;color:var(--ink)}
.dshu .desc{font-size:12.5px;color:var(--muted);line-height:1.65;margin-top:4px}
.dshu .desc b{color:var(--ink);font-weight:600}
.dshu .close{flex:none;width:24px;height:24px;border:0;border-radius:7px;background:transparent;color:var(--faint);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;transition:background .15s,color .15s}
.dshu .close:hover{background:var(--hover);color:var(--ink)}
/* 版本对比胶囊 */
.dshu .vers{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px}
.dshu .pill{font-size:11.5px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:.2px;padding:4px 10px;border-radius:999px;background:var(--dsw-alias-bg-module-platform,rgba(0,0,0,.04));border:1px solid var(--bd);color:var(--muted);white-space:nowrap}
.dshu .pill.new{color:#fff;border-color:transparent;background:var(--dsw-alias-button-info-fill,#4176e6)}
.dshu .pill.tag{color:var(--faint);background:transparent;border-color:transparent;padding:4px 2px}
.dshu .arrow{color:var(--faint);font-size:12px;flex:none}
/* 进度条（安装中，平面） */
.dshu .prog{height:6px;border-radius:999px;background:var(--dsw-alias-bg-module-platform,rgba(0,0,0,.05));overflow:hidden;margin-top:2px}
.dshu .prog>i{display:block;height:100%;width:38%;border-radius:999px;background:var(--accent);animation:dshu-indet 1.15s ease-in-out infinite}
@keyframes dshu-indet{0%{transform:translateX(-110%)}100%{transform:translateX(370%)}}
/* 安装日志（可折叠） */
.dshu .logbox{margin-top:2px;border:1px solid var(--bd);border-radius:10px;background:var(--dsw-alias-bg-module-platform,rgba(0,0,0,.03));overflow:hidden}
.dshu .logsum{display:flex;align-items:center;gap:6px;width:100%;padding:7px 10px;border:0;background:none;cursor:pointer;font-size:11.5px;color:var(--muted);text-align:left}
.dshu .logsum:hover{background:var(--hover)}
.dshu .logsum .chev{transition:transform .18s ease}
.dshu .logsum.open .chev{transform:rotate(90deg)}
.dshu .log{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;color:var(--faint);max-height:110px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;padding:8px 10px;border-top:1px solid var(--bd)}
/* 操作按钮（平面，无渐变无发光；主操作近黑，跟随 DSH 视觉语言） */
.dshu .ops{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:2px}
.dshu .ops .grow{flex:1}
.dshu .btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--bd2);background:var(--dsw-alias-button-elevated-fill,transparent);padding:8px 14px;border-radius:10px;cursor:pointer;font-size:12.5px;font-weight:500;line-height:1;color:var(--ink);transition:background .18s var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1)),border-color .18s,transform .12s var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1))}
.dshu .btn:hover{background:var(--hover)}
.dshu .btn:active{transform:scale(.97)}
.dshu .btn:disabled{opacity:.55;cursor:wait}
/* 主操作：近黑（--dsw-alias-button-primary-fill，与 GUI 主按钮一致），hover 提亮 + 微浮起；
   文字用 --dsw-alias-label-primary-foreground（on-primary 配套色：亮色白/暗色深，保证对比度） */
.dshu .btn.primary{border-color:transparent;color:var(--dsw-alias-label-primary-foreground,#fff);background:var(--dsw-alias-button-primary-fill,#0f1115)}
.dshu .btn.primary:hover{background:var(--dsw-alias-button-primary-hover,#43454a);transform:translateY(-1px)}
.dshu .btn.danger{border-color:transparent;color:#fff;background:var(--danger)}
.dshu .btn.danger:hover{filter:brightness(1.08)}
.dshu .btn.ghost{border-color:transparent;background:none;color:var(--muted)}
.dshu .btn.ghost:hover{background:var(--hover);color:var(--ink)}
.dshu .link{background:none;border:0;color:var(--accent);cursor:pointer;font-size:12px;padding:4px 2px;text-decoration:none}
.dshu .link:hover{text-decoration:underline}
.dshu .countdown{display:inline-flex;align-items:center;font-size:12px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--accent)}
/* ── 侧边栏底部入口 ─────────────────────────────── */
.dshu.foot-wrap{margin-left:auto;margin-top:42px;margin-bottom:-42px;position:relative;z-index:6;flex:none;display:flex;align-items:center}
.dshu .dshu-foot{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border:0;border-radius:10px;background:transparent;cursor:pointer;color:var(--faint);position:relative;transition:background .15s,color .15s,transform .1s}
.dshu .dshu-foot:hover{background:var(--hover);color:var(--ink)}
.dshu .dshu-foot:active{transform:scale(.92)}
.dshu .dshu-foot-ico{display:inline-flex;flex:none}
.dshu .dshu-foot-spin-svg{animation:dshu-rotate .9s linear infinite}
/* 状态提示点：仅一个小点，不突显按钮本身 */
.dshu .dot{position:absolute;top:4px;right:4px;width:8px;height:8px;border-radius:50%;border:1.5px solid var(--dsw-alias-bg-base,#fff)}
.dshu .dot.amber{background:#f59e0b;animation:dshu-pulse 1.6s ease-in-out infinite}
.dshu .dot.green{background:var(--ok)}
.dshu .dot.red{background:var(--danger)}
@keyframes dshu-rotate{to{transform:rotate(360deg)}}
@keyframes dshu-pulse{0%,100%{opacity:1}50%{opacity:.3}}
@media (prefers-reduced-motion:reduce){.dshu .card{animation:none}.dshu .prog>i{animation:none}.dshu .dshu-foot-spin-svg{animation:none}.dshu .dot.amber{animation:none}}
`;
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"" + cssId + "\"]") === null) {
			const tag = document.createElement("style");
			tag.setAttribute("data-plugin", "@louchi1984/dsh-auto-update");
			tag.setAttribute("data-plugin-css", cssId);
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
			"&": "&amp;",
			"<": "&lt;",
			">": "&gt;",
			"\"": "&quot;",
			"'": "&#39;"
		})[c]);
		async function api(path, body) {
			return (await fetch(path, {
				method: body === void 0 ? "GET" : "POST",
				headers: body === void 0 ? void 0 : { "content-type": "application/json" },
				body: body === void 0 ? void 0 : JSON.stringify(body)
			})).json();
		}
		const cardBus = {
			open: false,
			listeners: /* @__PURE__ */ new Set(),
			set(v) {
				this.open = v;
				for (const fn of this.listeners) fn(v);
			},
			toggle() {
				this.set(!this.open);
			},
			subscribe(fn) {
				this.listeners.add(fn);
				return () => this.listeners.delete(fn);
			}
		};
		const svg = (paths, attrs) => h("svg", Object.assign({
			width: 14,
			height: 14,
			viewBox: "0 0 16 16",
			fill: "none",
			stroke: "currentColor",
			strokeWidth: 1.6,
			strokeLinecap: "round",
			strokeLinejoin: "round"
		}, attrs), paths);
		const ICON_DOWNLOAD = h("svg", {
			width: 14,
			height: 14,
			viewBox: "0 0 16 16",
			fill: "none",
			xmlns: "http://www.w3.org/2000/svg"
		}, h("path", {
			d: "M15.3695 11.411L15.1234 12.8866C14.8869 14.3042 13.6603 15.3436 12.223 15.3436H3.77673C2.33958 15.3434 1.1128 14.3042 0.876343 12.8866L0.630249 11.411L2.05408 11.1747L2.29919 12.6493C2.41973 13.3713 3.04475 13.9001 3.77673 13.9003H12.223C12.9551 13.9002 13.58 13.3713 13.7006 12.6493L13.9457 11.1747L15.3695 11.411ZM8.72205 8.994C8.77717 8.93934 8.83792 8.88106 8.90271 8.81627L12.4828 5.23424L13.5043 6.25572L9.92224 9.8358C9.6395 10.1185 9.38763 10.3732 9.15857 10.5575C8.91892 10.7503 8.63953 10.9224 8.2865 10.9784C8.09711 11.0083 7.90363 11.0083 7.71423 10.9784C7.36106 10.9224 7.0809 10.7503 6.84119 10.5575C6.61215 10.3732 6.36022 10.1185 6.07751 9.8358L2.49646 6.25572L3.51697 5.23424L7.09705 8.81627C7.16219 8.88142 7.22331 8.94006 7.27869 8.99498V1.3065H8.72205V8.994Z",
			fill: "currentColor"
		}));
		const ICON_CHECK = svg([h("circle", {
			key: "c",
			cx: 8,
			cy: 8,
			r: 6.2
		}), h("path", {
			key: "k",
			d: "M5.4 8.2l1.9 1.9 3.3-3.6"
		})]);
		const ICON_ALERT = svg([
			h("circle", {
				key: "c",
				cx: 8,
				cy: 8,
				r: 6.2
			}),
			h("path", {
				key: "i",
				d: "M8 5v3.6"
			}),
			h("path", {
				key: "d",
				d: "M8 11.5v.1"
			})
		]);
		const ICON_SPIN = svg([h("circle", {
			key: "c",
			cx: 8,
			cy: 8,
			r: 6,
			strokeWidth: 2,
			strokeDasharray: 26,
			strokeDashoffset: 8,
			strokeLinecap: "round"
		})]);
		const ICON_CLOSE = svg([h("path", {
			key: "a",
			d: "M4.8 4.8l6.4 6.4"
		}), h("path", {
			key: "b",
			d: "M11.2 4.8l-6.4 6.4"
		})]);
		const ICON_CHEVRON = svg([h("path", {
			key: "a",
			d: "M6.2 3.8l4.2 4.2-4.2 4.2"
		})]);
		function UpdateWidget() {
			const [s, setS] = React.useState(null);
			const [now, setNow] = React.useState(Date.now());
			const [open, setOpen] = React.useState(cardBus.open);
			const [hidden, setHidden] = React.useState(false);
			const [checking, setChecking] = React.useState(false);
			const [logOpen, setLogOpen] = React.useState(true);
			const [reloading, setReloading] = React.useState(false);
			const [reloadFailed, setReloadFailed] = React.useState(false);
			const prevStatus = React.useRef(null);
			const reloadPid = React.useRef(null);
			React.useEffect(() => cardBus.subscribe((v) => {
				setOpen(v);
				if (v) setHidden(false);
			}), []);
			const refresh = React.useCallback(async () => {
				try {
					const st = await api("/dsh-update/status");
					setS(st);
				} catch (_e) {}
			}, []);
			React.useEffect(() => {
				refresh();
				const t = setInterval(refresh, 15e3);
				const clock = setInterval(() => setNow(Date.now()), 1e3);
				return () => {
					clearInterval(t);
					clearInterval(clock);
				};
			}, [refresh]);
			React.useEffect(() => {
				if (s && s.status && s.status !== prevStatus.current) {
					prevStatus.current = s.status;
					setHidden(false);
				}
			}, [s]);
			React.useEffect(() => {
				if (!open) return;
				const onKey = (ev) => {
					if (ev.key === "Escape") {
						cardBus.set(false);
						setHidden(true);
					}
				};
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [open]);
			React.useEffect(() => {
				if (!s) return;
				const st = s.status;
				if (!(st === "installed" || st === "restarting")) return;
				if (st === "installed" && s.restartAt && now < s.restartAt) return;
				if (reloadPid.current === null && s.pid) reloadPid.current = s.pid;
				setReloading(true);
				setReloadFailed(false);
				let tries = 0;
				const timer = setInterval(async () => {
					tries++;
					try {
						const st2 = await (await fetch("/dsh-update/status", {
							cache: "no-store",
							signal: AbortSignal.timeout(2e3)
						})).json();
						if (st2 && st2.pid && reloadPid.current && st2.pid !== reloadPid.current) {
							clearInterval(timer);
							window.location.reload();
							return;
						}
					} catch (_e) {}
					if (tries >= 60) {
						clearInterval(timer);
						setReloading(false);
						setReloadFailed(true);
					}
				}, 1e3);
				return () => clearInterval(timer);
			}, [
				s && s.status,
				s && s.restartAt,
				now >= (s && s.restartAt ? s.restartAt : 0)
			]);
			if (!s || !s.ok) return null;
			const st = s.status;
			const auto = st === "installing" || st === "installed" || st === "restarting" || st === "error" && (s.target || s.installLog);
			if (!((open || auto || checking) && !hidden)) return null;
			const close = () => {
				cardBus.set(false);
				setHidden(true);
			};
			const countdown = s.restartAt ? Math.max(0, Math.ceil((s.restartAt - now) / 1e3)) : null;
			const targetVer = s.target ? s.target.version : s.installedVersion || "";
			const tag = s.target ? s.target.tag : "";
			let title, desc, vers, prog, ops, showClose = true;
			if (checking || st === "checking") {
				title = "正在检查更新…";
				desc = "正在查询 npm 仓库中的最新版本…";
			} else if (st === "update-available") {
				title = "发现新版本";
				desc = h("div", null, ["安装完成后会自动重启生效。", s.publishedAt ? h("div", { key: "p" }, "发布于 " + new Date(s.publishedAt).toLocaleString()) : null]);
				vers = h("div", { className: "vers" }, [
					h("span", { className: "pill" }, "当前 " + s.current),
					h("span", { className: "arrow" }, "→"),
					h("span", { className: "pill new" }, "v" + targetVer),
					tag ? h("span", { className: "pill tag" }, tag + " 通道") : null
				]);
				ops = [
					h("a", {
						key: "log",
						className: "link",
						href: s.changelogUrl || "https://github.com/deepseek-ai/deepseek-harness/releases",
						target: "_blank",
						rel: "noreferrer"
					}, "更新日志 ↗"),
					h("span", {
						key: "g",
						className: "grow"
					}),
					h("button", {
						key: "x",
						className: "btn ghost",
						onClick: () => api("/dsh-update/dismiss", { version: s.target.version }).then(setS).catch(refresh)
					}, "稍后"),
					h("button", {
						key: "i",
						className: "btn primary",
						onClick: () => api("/dsh-update/install", { tag: s.target.tag }).then(setS).catch(refresh)
					}, "下载并安装")
				];
			} else if (st === "installing") {
				title = "正在安装新版本";
				desc = h("div", null, [
					"执行 ",
					h("b", null, "npm install -g @deepseek-ai/dsh" + (tag ? "@" + tag : "")),
					"，约 10–30 秒，请稍候…"
				]);
				vers = targetVer ? h("div", { className: "vers" }, [
					h("span", { className: "pill" }, "当前 " + s.current),
					h("span", { className: "arrow" }, "→"),
					h("span", { className: "pill new" }, "v" + targetVer)
				]) : null;
				prog = h("div", {
					key: "p",
					className: "prog"
				}, h("i"));
				ops = [h("span", {
					key: "g",
					className: "grow"
				}), h("button", {
					key: "x",
					className: "btn ghost",
					onClick: () => api("/dsh-update/cancel-install").then(setS).catch(refresh)
				}, "取消安装")];
			} else if (st === "installed") {
				title = "安装完成" + (s.installedVersion ? " v" + s.installedVersion : "");
				desc = reloading ? "正在自动重启并刷新页面…" : reloadFailed ? "自动刷新未成功，请手动刷新页面。" : "正在自动重启…";
				vers = countdown !== null && countdown > 0 ? h("div", { className: "vers" }, [h("span", { className: "pill countdown" }, "● " + countdown + " 秒后自动重启")]) : null;
				ops = [];
				showClose = false;
			} else if (st === "restarting") {
				title = "正在重启 dsh web…";
				desc = reloading ? "新实例就绪后页面将自动刷新，无需手动操作。" : reloadFailed ? "自动刷新未成功，请手动刷新页面。" : "页面将断开数秒，刷新后即恢复。会话已持久化在磁盘，会自动恢复。";
				ops = [];
			} else if (st === "error") {
				title = "自动更新异常";
				desc = h("div", null, esc(s.error || "未知错误"));
				ops = [
					s.target ? h("button", {
						key: "retry",
						className: "btn primary",
						onClick: () => api("/dsh-update/install", { tag: s.target.tag }).then(setS).catch(refresh)
					}, "重试安装") : h("button", {
						key: "check",
						className: "btn",
						onClick: () => api("/dsh-update/check").then(setS).catch(refresh)
					}, "重新检查"),
					h("span", {
						key: "g",
						className: "grow"
					}),
					h("button", {
						key: "x",
						className: "btn ghost",
						onClick: close
					}, "关闭")
				];
			} else {
				title = "已是最新版本";
				vers = h("div", { className: "vers" }, [h("span", { className: "pill" }, "当前 v" + s.current), s.lastCheck ? h("span", { className: "pill tag" }, "上次检查 " + new Date(s.lastCheck).toLocaleTimeString()) : null]);
				ops = [
					h("a", {
						key: "log",
						className: "link",
						href: "https://github.com/deepseek-ai/deepseek-harness/releases",
						target: "_blank",
						rel: "noreferrer"
					}, "官方更新日志 ↗"),
					h("span", {
						key: "g",
						className: "grow"
					}),
					h("button", {
						key: "c",
						className: "btn",
						onClick: async () => {
							setChecking(true);
							try {
								setS(await api("/dsh-update/check"));
							} catch (_e) {} finally {
								setChecking(false);
							}
						}
					}, "重新检查")
				];
			}
			return h("div", { className: "dshu" }, [h("div", {
				key: "card",
				className: "card"
			}, [
				h("div", {
					key: "top",
					className: "top"
				}, [h("div", {
					key: "titles",
					className: "titles"
				}, [
					h("div", {
						key: "t",
						className: "title"
					}, title),
					desc ? h("div", {
						key: "d",
						className: "desc"
					}, desc) : null,
					vers
				]), showClose ? h("button", {
					key: "c",
					className: "close",
					title: "收起",
					"aria-label": "收起",
					onClick: close
				}, ICON_CLOSE) : null]),
				prog,
				s.installLog ? h("div", {
					key: "lb",
					className: "logbox"
				}, [h("button", {
					key: "ls",
					className: "logsum" + (logOpen ? " open" : ""),
					onClick: () => setLogOpen(!logOpen)
				}, [h("span", {
					key: "ch",
					className: "chev"
				}, ICON_CHEVRON), "安装日志"]), logOpen ? h("div", {
					key: "lg",
					className: "log"
				}, esc(s.installLog)) : null]) : null,
				ops.length ? h("div", {
					key: "o",
					className: "ops"
				}, ops) : null
			])]);
		}
		function UpdateEntry({ wide }) {
			const [s, setS] = React.useState(null);
			const refresh = React.useCallback(async () => {
				try {
					const st = await api("/dsh-update/status");
					setS(st);
				} catch (_e) {}
			}, []);
			React.useEffect(() => {
				refresh();
				const t = setInterval(refresh, 15e3);
				return () => clearInterval(t);
			}, [refresh]);
			if (!s || !s.ok) return null;
			if (!wide) return null;
			const st = s.status;
			const busy = st === "installing" || st === "restarting" || st === "checking";
			let content, dotCls, title;
			if (busy) {
				content = h("span", {
					key: "i",
					className: "dshu-foot-ico dshu-foot-spin-svg"
				}, ICON_SPIN);
				title = st === "installing" ? "正在安装…（点右上角卡片可取消）" : st === "restarting" ? "正在重启…（就绪后自动刷新）" : "正在检查更新…";
			} else if (st === "update-available") {
				content = h("span", {
					key: "i",
					className: "dshu-foot-ico"
				}, ICON_DOWNLOAD);
				if (!s.dismissed) dotCls = "amber";
				title = "发现新版本 " + (s.target && s.target.version) + "（" + (s.target && s.target.tag) + "），点击查看详情";
			} else if (st === "error") {
				content = h("span", {
					key: "i",
					className: "dshu-foot-ico"
				}, ICON_ALERT);
				dotCls = "red";
				title = s.error || "更新异常，点击查看";
			} else {
				content = h("span", {
					key: "i",
					className: "dshu-foot-ico"
				}, ICON_CHECK);
				title = "已是最新版本（" + (s.current || "") + "）· 点击检查更新或查看官方更新日志";
			}
			const onClick = () => {
				if (busy) return;
				cardBus.toggle();
			};
			return h("div", { className: "dshu foot-wrap" }, [h("button", {
				className: "dshu-foot",
				title,
				"aria-label": title,
				onClick
			}, [content, dotCls ? h("span", {
				key: "n",
				className: "dot " + dotCls
			}) : null])]);
		}
		function apply(ctx) {
			ctx.inject(["slots"], (scope) => {
				scope.slots.inject("sidebar.footer.action", () => scope.slots.register({
					name: "sidebar.footer.action",
					id: "mine-auto-update-entry",
					order: 1
				}, UpdateEntry));
				scope.slots.inject("shell.overlay", () => scope.slots.register({
					name: "shell.overlay",
					id: "mine-auto-update-widget",
					order: 2
				}, UpdateWidget));
			});
		}
		const inject = ["slots"];
		exports.apply = apply;
		exports.inject = inject;
		//#endregion
		return exports;
	}
});
