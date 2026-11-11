# DeskWeek · 周历清单

<p align="center">
  <img src="assets/icons/app-icon.png" width="112" alt="DeskWeek icon">
</p>

DeskWeek 是一款专为 Windows 设计的桌面周历与待办事项工具。它直接贴合在桌面背景上显示，不替换也不破坏系统壁纸；所有待办和日历数据默认仅保存在你的本地电脑中。

## 下载使用

你可以在 [GitHub Releases](https://github.com/EasonGuuu/Deskweek/releases/latest) 下载：
- **安装包（Setup.exe）**：适合多数用户，支持安装向导、自动创建桌面与开始菜单快捷方式，支持开机自启和控制面板一键卸载。
- **便携版（Portable.zip）**：适合喜欢绿色免安装的用户，解压到任意文件夹后双击 `DeskWeek.exe` 即可使用。

> 提示：如果使用便携版，升级时只需保留 `data/` 文件夹即可完整迁移已有日程和配置。安装版覆盖安装时会自动保留用户数据。

## 相关文档

- [多显示器全屏独立检测说明](docs/multimonitor-fullscreen-fix.md)：多显示器环境下主副屏全屏独立判定说明。
- [多端协同与同步指引](docs/android-lan-integration.md)：Windows 与 Android 手机/平板互通指引。
- [二维码离线传输指南](docs/offline-json-qr.md)：面对面无网扫码互传操作方法。
- [故障排查](docs/故障排查.md)：浮窗不显示、短暂闪退、报错提示或保存失败时的解决方法。
- [桌面层与动态壁纸兼容性](docs/桌面层与动态壁纸兼容性.md)：多显示器使用、Wallpaper Engine 动态壁纸兼容性与显示说明。

## 主要功能

- **桌面小部件与独立管理中心**：既可在桌面随时浏览日程，也可打开管理中心高效录入和整理任务。
- **多种日历视图**：支持年、月、周、日四种视图随时切换。
- **灵活的待办排序**：支持按到期、创建顺序、日期和具体时间等多种规则排序。
- **完整的任务管理**：支持标题、详细备忘、完成打勾、废纸篓与一键恢复。
- **提前与延后提醒**：任务可设置提前数天或一个月出现在待办清单中，日历视图中始终清晰可见。
- **浅色与深色主题**：自动适配明暗环境，日夜皆宜。
- **全透明浮窗模式**：去除白色底板和卡片阴影，仅保留日程文字与必要操作，完美融入各类电脑壁纸；可在「管理中心 → 设置 → 浮窗背景」中开启。
- **跨端协同与面对面二维码传输**：支持与 Android 手机和平板免网面对面扫码互传日程，也可开启局域网协同同步。
- **农历、节气与节假日**：支持公历、农历对照、二十四节气、法定节假日与休假调休标记。
- **可选 AI 助手总结**：在「设置 → AI 导入」或任务的详细输入里，导入文本、截图以及 PDF、Word、Excel、PPTX 等资料，自动提取多条待办事项，确认后勾选或一键导入到待办。
- **自动翻译整理**：可将外语资料自动提炼整理为中文待办。
- **内置检查更新**：检测到新版本后，用户确认即可自动下载更新并平滑重启，保留所有本地数据。
- **纯本地便携数据**：所有待办保存在程序旁的 `data/data.json` 中，随时打包带走。

## 多端数据协同

DeskWeek 提供两种简单便捷的多端协同方式：

1. **二维码面对面离线传输（推荐）**
   - 电脑与手机无需处于同一局域网，也不需要外网连接。
   - 电脑「设置 → 离线传输与备份」点击生成二维码，手机扫描即可导入；反之手机展示二维码，电脑开启摄像头即可扫描录入。
2. **局域网协同同步**
   - 在同一个 Wi-Fi 或局域网下，开启同步开关即可自动发现对方设备，首次配对核对 6 位数字验证码，此后自动保持互通。

配套 Android 手机与平板客户端源码见 [BuyMyCheatPlz/DeskWeek-Android](https://github.com/BuyMyCheatPlz/DeskWeek-Android)。

## 本地开发与构建

环境需求：Node.js 与 npm。

```powershell
npm install
npm start
```

### 测试命令

| 命令 | 用途 |
| --- | --- |
| `npm run check` | 检查 JavaScript 代码语法 |
| `npm test` | 核心功能自动化测试（数据读写、多屏计算、全屏检测、二维码编解码、同步协议等） |
| `npm run test:host` | 桌面环境集成测试（多屏拖动、双窗口同步、全屏休眠、设置页 AI 导入写盘等） |
| `npm run test:ai` | AI 导入回归（真实窗口 + 本地 mock AI，覆盖浮窗/设置页/非法日期跳过） |
| `npm run test:multimonitor` | 真实双屏全屏隔离测试（需设置 `DESKWEEK_MULTI_EVIDENCE`，详见[修复说明](docs/multimonitor-fullscreen-fix.md)） |
| `npm run test:qr` | 二维码离线传输集成测试（真实图片解码、摄像头流与确认导入） |
| `npm run test:visibility` | 桌面可见性测试（验证后台辅助软件不会误触发浮窗隐藏） |
| `npm run test:resume` | 休眠唤醒测试（验证频繁休眠恢复时的稳定性） |
| `npm run test:appearance` | 外观测试（深浅主题与透明背景渲染效果） |
| `npm run test:packaged` | 打包产物自动化测试 |

### 打包 Windows 程序与安装包

```powershell
# 1. 打包生成绿色便携版目录 (dist/DeskWeek-win32-x64/)
npm run package

# 2. 构建 Windows 安装包 (dist/DeskWeek-v2.2.0-windows-x64-Setup.exe)
npm run package:installer
```

## 数据安全与隐私

- **默认纯本地**：所有日程数据保存在本地 `data/data.json` 中，不联网、不上传。
- **安全防损坏机制**：保存时写入临时文件再安全替换，并自动生成 `.backup` 备份文件。即使意外断电导致主文件损坏，程序也会尝试自动从备份中还原，保护你的日程不丢失。
- **多窗口编辑防覆盖**：如果在浮窗和管理中心同时编辑了同一个任务，程序会自动合并不同字段的改动；若发生直接文字冲突，会弹窗提示确认。
- **API 密钥加密**：AI 总结功能所需的 API Key 采用 Windows 系统内置加密存储在 `data/ai-key.dat`，界面不会显示明文密钥。
- **输入草稿保护**：编辑中的文字在程序运行时会自动暂存，遇到系统桌面重置也能保留内容。

## 开源许可

本项目源代码采用 [MIT 许可证](LICENSE)。

第三方开源库与素材归属见 [ATTRIBUTIONS.md](docs/ATTRIBUTIONS.md)。
