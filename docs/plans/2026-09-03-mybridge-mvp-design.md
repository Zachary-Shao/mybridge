# MyBridge V0.1 Design

## Goal

让同一局域网中的 Windows 电脑可以把指定 Source Folder 的新增和更新文件，自动同步到 Mac 指定的 Destination Folder；不需要账号、云服务或数据库。

## Recommendation

V0.1 采用跨平台 Node.js 本地 Agent + 本地浏览器控制台，而不是现在就引入 Tauri/React 或 Syncthing。Node.js 22 已经在开发环境中可用，Rust/Tauri 当前不可用；标准库足够覆盖局域网发现、HTTP 流式传输、目录监听和 JSON 配置，依赖更少、调试更直接。核心模块不依赖 UI，后续可被 Tauri 壳复用。

备选方案：

1. Tauri + React + Syncthing：长期产品形态最好，但本地需要 Rust/Syncthing 生命周期管理，超出当前 MVP 的最短闭环。
2. Electron + Node：桌面体验更完整，但包体和依赖较重，暂不选择。
3. Node Agent + 本地 Web UI：今天即可在 Windows/macOS 跑通真实同步，作为推荐方案。

## Architecture

```text
┌──────────────────────────────┐       UDP broadcast       ┌──────────────────────────────┐
│ Windows: MyBridge Agent      │  ───────────────────────▶ │ Mac: MyBridge Agent          │
│                              │                            │                              │
│ Source Folder                │       HTTP pair/file       │ Destination Folder            │
│ fs.watch + initial scan      │  ───────────────────────▶ │ temp write + atomic replace  │
│ Local control console        │                            │ Local control console         │
└──────────────┬───────────────┘                            └──────────────┬───────────────┘
               │                                                         │
               └────────────── local JSON config + activity log ─────────┘
```

两台设备运行同一个程序，通过角色配置决定是否作为源端/目标端。源端只发送文件，不删除目标端文件；目标端只接受已配对源端的 PUT 请求。相对路径经过规范化和根目录校验，避免路径穿越。

## Data Flow

1. Agent 启动，加载平台专属 JSON 配置，启动 HTTP 服务和 UDP discovery。
2. 两台设备每 2 秒广播设备 ID、名称、HTTP 端口和配置状态。
3. 源端在控制台选择发现到的目标设备并点击 Pair；目标端生成本地 token 返回，双方保存配对信息。
4. 源端保存 Source Folder 后进行一次全量扫描，再监听递归文件变化。
5. 文件事件经过短暂 debounce 和稳定性检查后，以相对路径发送给目标端。
6. 目标端将内容写入同目录临时文件，完成后原子替换为目标文件，并返回成功结果。
7. 两端把最近事件写入各自 JSON 配置，UI 轮询 `/api/state` 展示状态。

## Failure Handling

- 目标离线或连接失败：源端记录失败，不删除源文件；下一次文件变化或手动 Resync 可重试。
- 文件仍在写入：源端等待 size/mtime 稳定后再发送。
- 目标端磁盘写入失败：返回 4xx/5xx 并记录失败详情。
- 目标文件已存在：以临时文件完成后替换，避免半文件。
- 删除事件：V0.1 不同步删除，目标文件保留。
- 端口冲突：HTTP 端口自动向后寻找空闲端口，UI 显示实际端口。

## UI Direction

使用深墨色背景、米白内容面板和安全橙/荧光黄绿色状态色，做成“个人设备链路控制台”而非云盘列表。首屏按三块组织：链路总览、文件夹配置、最近活动；空状态直接告诉用户下一步，错误状态保留原因和重试动作。表单支持键盘操作，颜色不作为唯一状态表达。

## V0.1 Scope Boundaries

- 支持 Windows/macOS；本地 Web 控制台可用浏览器打开。
- 只实现 Windows → Mac 的单向新增/更新同步。
- 不同步删除、不做双向冲突、不做公网、账号、云端或数据库。
- 采用共享 token 做局域网配对后的最小访问控制，不引入账号体系。

