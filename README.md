# MyBridge

MyBridge 是一个面向个人用户的轻量级 Windows → Mac 局域网文件同步 MVP。

当前版本先采用 Node.js 本地 Agent + 浏览器控制台：两台电脑各运行一个 Agent，源端监听 Source Folder，目标端把文件写入 Destination Folder。没有账号、云服务器、数据库或公网传输。

## 当前状态

- 已实现的核心方向：跨平台 Agent、局域网 UDP 发现、HTTP 配对、文件流式传输、临时文件原子替换、递归监听、初始全量扫描、本地活动记录。
- V0.1 不同步删除，只同步新增和更新；不做双向同步、冲突解决或公网传输。
- 当前环境没有 Rust/Tauri，因此 UI 先以本地浏览器控制台交付；同步核心已与 UI 分离，后续可以换成 Tauri/React 壳。

## 运行要求

- Windows 10+ 或 macOS 12+
- Node.js 20+
- 两台电脑在同一局域网

## 本机运行

```bash
npm test
npm start -- --port 39875
```

打开控制台：<http://127.0.0.1:39875>

每台设备应使用不同 HTTP 端口。若系统防火墙询问 Node.js 是否允许局域网访问，请允许专用网络访问；UDP 发现使用 39876 端口。

## 两台设备配置

1. Mac 启动 MyBridge，在控制台填写 Destination Folder 并保存。
2. Windows 启动 MyBridge，在控制台填写 Source Folder 并保存。
3. Windows 控制台的 Discovered devices 中选择 Mac，点击 Pair。
4. 将文件放入 Windows Source Folder；文件出现或更新后，Mac Destination Folder 会自动收到同样的相对路径。

如果 UDP 发现被防火墙拦截，V0.1 控制台也允许手动填写对方的 `http://局域网IP:端口` 进行配对。

## 配置位置

- macOS：`~/Library/Application Support/MyBridge/config.json`
- Windows：`%APPDATA%\\MyBridge\\config.json`

测试或开发时可以通过 `--data-dir <path>` 使用隔离配置目录。
