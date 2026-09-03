# MyBridge

## Download

MyBridge 是一个面向个人用户的轻量级 Windows → Mac 局域网项目文件夹镜像工具。它不需要账号、云服务器或手动传文件。

- Windows 10/11 x64：[Download MyBridge for Windows](../../releases/latest)
  - Release Asset：`MyBridge-<version>-x64-Setup.exe`
- macOS Apple Silicon：[Download MyBridge for Mac](../../releases/latest)
  - Release Asset：`MyBridge-<version>-arm64.dmg`

### Windows

1. 下载 Windows x64 的 `.exe` 安装器并双击运行。
2. 按安装向导完成安装；之后可以从开始菜单启动 MyBridge。
3. 当前开发版尚未进行代码签名。如果 Windows SmartScreen 提示风险，请点击 **More info → Run anyway**。
4. 在 Windows 端选择要镜像的完整项目目录，然后按界面提示连接设备；Mac 会在 MyBridge 根目录下自动创建对应镜像。

安装器会创建开始菜单快捷方式。关闭主窗口后，MyBridge 仍会留在系统托盘中继续同步；也可以从托盘菜单暂停同步、重新打开窗口或退出程序。Windows 卸载可在“设置 → 应用”中完成。

### Mac

1. 下载 macOS Apple Silicon 的 `.dmg` 文件。
2. 打开 DMG，将 MyBridge 拖入 **Applications**。
3. 当前开发版尚未签名和 notarize。如果 macOS 阻止首次启动，请在 Applications 中按住 Control 点击 MyBridge，选择 **Open**，再确认一次；也可以到“系统设置 → 隐私与安全性”中点击 **仍要打开 / Open Anyway**。
4. 打开 MyBridge，等待自动发现 Windows 设备并完成连接。

## 使用方式

1. 在 Windows 和 Mac 上分别打开 MyBridge，并让两台电脑连接同一局域网。
2. 在 Windows 的附近设备列表中点击 Mac 的“连接”。
3. 选择完整的 Windows Project Folder，可修改显示名称，然后点击“开始同步”。
4. Mac 会自动创建镜像目录；已有文件会先补齐，之后新增和修改会自动同步，目录结构和相对路径保持一致。
5. Mac 镜像卡片可以直接在 Finder 中打开。网络中断、对方睡眠或电脑重启后，Agent 会自动恢复连接并补齐遗漏文件。

当前只支持 Windows → Mac 的新增和更新同步。Windows 删除文件不会删除 Mac 副本；暂不支持双向同步、冲突解决、公网传输、云存储、账号和手机端。

## Ignore Rules

默认忽略明显不需要同步的内容：`.git`、`node_modules`、`.DS_Store`、`cache`、`.cache`、`log`、`logs`、`*.log`、`*.tmp`、`*.temp`、`*.part`、编辑器交换文件和 MyBridge 临时文件。

可以在“高级设置”中按行增加规则，例如 `*.bak` 或 `private/**`。规则只影响新增/更新扫描，不会删除 Mac 上已经存在的文件。

## Development

需要 Node.js 20+。普通用户使用安装包时不需要安装 Node.js，安装包已包含 MyBridge 运行所需环境。

```bash
npm ci
npm test
npm run desktop
```

常用构建命令必须在对应平台执行：

```bash
# Windows runner or Windows development machine
npm run build:win:x64

# macOS Apple Silicon runner or Mac development machine
npm run build:mac:arm64
```

Windows 构建会生成 x64 NSIS 安装器，并额外生成 x64 Portable `.exe` 供快速测试；正式交付优先使用 NSIS 安装器。macOS 构建生成 Apple Silicon DMG。输出目录均为 `release/`。

无桌面 CLI 诊断模式仍可使用：

```bash
npm start -- --port 39875
```

CLI 模式控制台地址为 `http://127.0.0.1:39875`。普通用户不需要使用 CLI、访问本地控制台或查看 HTTP 端口。

如果系统防火墙询问 MyBridge 是否允许局域网访问，请允许专用网络访问；UDP 发现使用 39876 端口。UDP 发现失败时，可以在高级设置中手动填写对方地址进行配对。

## 配置与测试

本地配置由应用保存，不随安装包发布：

- macOS：`~/Library/Application Support/MyBridge/config.json`
- Windows：`%APPDATA%\\MyBridge\\config.json`

测试或开发时可以通过 `--data-dir <path>` 使用隔离配置目录。

```bash
npm test
```

测试覆盖双 Agent 配对、Folder Mirror 初始扫描、嵌套目录、中文文件名、Ignore Rules、空目录、同名目录、移除不删文件、断线重连、1,000 个小文件和 500 MB 文件流式传输。

## GitHub Release

推送形如 `v0.3.0` 的 Git tag 后，GitHub Actions 会在原生 Windows 和 macOS runner 上分别运行测试并构建：

- `MyBridge-0.3.0-x64-Setup.exe`
- `MyBridge-0.3.0-arm64.dmg`

随后工作流会自动创建 GitHub Release 并上传这两个文件。Windows 不依赖 macOS 交叉构建；当前版本也不启用自动更新、Windows 签名、Apple Developer 签名或 notarization。
