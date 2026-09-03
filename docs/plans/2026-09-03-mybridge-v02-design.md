# MyBridge V0.2 Desktop Design

## Requirements Summary

V0.2 的目标不是扩大同步范围，而是让已有 Windows → Mac 单向同步成为普通用户可以安装、关闭窗口后继续运行、重启后自动恢复的桌面应用。必须保留 UDP 发现、HTTP 配对、源目录监听、目标端原子写入、本地 JSON 配置和 Activity 记录。

## Technology Decision

评估 Tauri 后暂不采用：当前开发环境没有 Rust、Cargo 或 Tauri CLI，安装后还需要处理 Windows/macOS 原生构建工具链；这会延迟现有闭环的桌面化。V0.2 采用 Electron 作为最小桌面壳，直接在 Electron 主进程中启动现有 `Agent`，渲染窗口继续加载本地 HTTP UI。这样窗口、托盘、目录选择和开机启动都由 Electron 提供，同步核心保持 Node 模块不变。

Electron 的代价是安装包和内存占用比 Tauri 更大，但它是当前环境下最快能形成 Windows/macOS 可安装物的成熟路线。未来若安装包体积成为问题，可以把同样的 `Agent` 接到 Tauri，迁移范围集中在 `electron-main.js` 和 `preload.js`。

## High-Level Architecture

```text
┌──────────────────────────────── MyBridge Desktop ────────────────────────────────┐
│ Electron main process                                                            │
│  app lifecycle · BrowserWindow · Tray · auto-launch · native folder dialog       │
│             │ IPC (preload, contextIsolation)                                    │
│             ▼                                                                    │
│  existing Agent                                                                   │
│  HTTP server · UDP discovery · SyncEngine · FileReceiver · JSON ConfigStore       │
│             │                                                                     │
│             ▼                                                                     │
│  BrowserWindow loads http://127.0.0.1:<ephemeral-port>                            │
│  existing UI + native folder buttons + ordinary-user onboarding                 │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Electron 不直接处理文件同步。它只负责桌面生命周期和少量系统能力：窗口关闭时隐藏、托盘菜单控制 Agent、原生目录选择、开机启动设置。`Agent` 仍是唯一的同步运行时。

## User Flow

1. 用户安装并打开应用，窗口显示本机设备名和“等待配对”。
2. Agent 自动广播并刷新附近设备；用户点击另一台设备的“连接”。
3. 用户通过原生目录选择器分别选择 Source Folder 或 Destination Folder，普通用户不接触 IP、HTTP Port 和 Token。
4. 配置完成后首页显示对方在线、同步状态和最近 Activity。
5. 关闭窗口只隐藏到托盘；托盘可 Open、Pause/Resume Sync、Quit。
6. 开机启动时 Agent 先后台启动；用户可从托盘打开主窗口。

## Runtime States

对用户展示四种同步状态：

- `Waiting`：未完成配对/目录配置，或正在等待对方上线。
- `Syncing`：正在传输文件。
- `Synced`：最近一次传输成功。
- `Failed`：最近一次传输失败，展示简单原因，并保留源文件等待重试。

托盘的暂停是独立的 `paused` 标记，不改变同步协议；恢复时进行一次全量扫描，确保暂停期间发生的文件变化不会丢失。

## Failure and Recovery

- Agent 启动失败：Electron 显示错误对话框并退出，不留下半启动状态。
- UDP 端口冲突或广播异常：Agent 继续运行，设备列表可为空，Advanced Settings 保留手动配对入口。
- HTTP 文件请求失败：SyncEngine 记录 `Failed` 和可读原因；下一次文件变化或恢复时的全量扫描重试。
- Wi-Fi 断开/目标睡眠：HTTP 请求超时后保持 Agent 进程存活；Discovery 恢复广播，对方回到局域网后自动刷新在线状态。
- 关窗：只隐藏 BrowserWindow，Agent 和托盘继续运行。
- Quit/系统退出：先停止 watcher、UDP socket 和 HTTP server，再结束 Electron。

## Packaging

使用 `electron-builder` 生成 macOS DMG/ZIP 和 Windows NSIS/Portable 包。应用资源包含 `src/`、`public/` 和生产依赖；开发脚本仍保留给测试，普通用户不需要接触它们。V0.2 在当前 macOS 环境验证 macOS 开发启动和打包配置，Windows 安装包需要在 Windows runner 或真实 Windows 机器上做最终签名/安装验证。

