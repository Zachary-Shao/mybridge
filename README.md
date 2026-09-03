# MyBridge

MyBridge 是一个面向个人用户的轻量级 Windows → Mac 局域网文件同步桌面应用。

桌面版使用 Electron 壳启动本地 Agent：两台电脑各运行一个 MyBridge，源端监听 Source Folder，目标端把文件写入 Destination Folder。没有账号、云服务器、数据库或公网传输。

## 当前状态

- 已实现的核心方向：跨平台 Agent、局域网 UDP 发现、HTTP 配对、文件流式传输、临时文件原子替换、递归监听、初始全量扫描、本地活动记录。
- V0.1 不同步删除，只同步新增和更新；不做双向同步、冲突解决或公网传输。
- V0.2 已增加 Electron 桌面壳、系统托盘、原生目录选择、开机启动、暂停/恢复和断线后自动补同步。
- 当前环境没有 Rust/Tauri，因此暂不采用 Tauri；同步核心已与桌面壳分离，未来可以替换壳而不重写同步协议。

## 运行要求

- Windows 10+ 或 macOS 12+
- 两台电脑在同一局域网

普通用户使用安装包时不需要安装 Node.js；安装包已包含 MyBridge 运行所需环境。

开发运行需要 Node.js 20+。

## 开发运行

```bash
npm test
npm run desktop
```

`npm run desktop` 会打开 MyBridge 桌面窗口，并在后台启动 Agent。仍可使用下面的命令启动无桌面 CLI 诊断模式：

```bash
npm start -- --port 39875
```

CLI 模式控制台地址：<http://127.0.0.1:39875>

## 构建安装包

需要在目标平台上构建对应安装包：

```bash
npm install
npm run dist
```

- macOS 输出 DMG/ZIP 到 `release/`
- Windows 输出 NSIS/Portable 到 `release/`

最终 Windows 安装包应在 Windows 机器上安装验证；macOS 安装包应在目标 macOS 版本上验证签名和首次启动权限。

若系统防火墙询问 MyBridge 是否允许局域网访问，请允许专用网络访问；UDP 发现使用 39876 端口。普通用户不需要查看 HTTP 端口，桌面壳会自动处理本机端口。

## 两台设备配置

1. 在 Mac 和 Windows 分别安装并打开 MyBridge。
2. 在 Mac 选择 Destination Folder，在 Windows 选择 Source Folder。
3. 在 Windows 的附近设备列表中点击 Mac 的“连接”。
4. 将文件放入 Windows Source Folder；文件出现或更新后，Mac Destination Folder 会自动收到同样的相对路径。
5. 关闭窗口后 MyBridge 会留在系统托盘继续工作；电脑重启后会自动启动。

如果 UDP 发现被防火墙拦截，可以在 Advanced Settings 中手动填写对方地址进行配对。网络或对方电脑暂时不可用时，源端保留失败状态；对方恢复后会自动重新发现并补同步。

## 配置位置

- macOS：`~/Library/Application Support/MyBridge/config.json`
- Windows：`%APPDATA%\\MyBridge\\config.json`

测试或开发时可以通过 `--data-dir <path>` 使用隔离配置目录。

## V0.1/V0.2 边界

当前只支持 Windows → Mac 单向新增和更新同步。删除同步、双向同步、冲突解决、公网传输、云存储、登录注册和手机端均未实现。
