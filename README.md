# DeskWeek · 周历清单

<p align="center">
  <img src="app-icon.png" width="112" alt="DeskWeek icon">
</p>

DeskWeek 是一个面向 Windows 的桌面周历与待办浮窗。它附着在桌面层工作，不替换壁纸；任务数据默认只保存在本机。

## 下载

可在 [GitHub Releases](https://github.com/EasonGuuu/Deskweek/releases/latest) 下载 Windows x64 便携版。

## 功能

- 桌面浮窗与独立管理中心
- 年、月、周、日四种日历视图
- 按逾期、默认、日期和时间排序的待办列表
- 任务主标题、详细内容、完成状态、垃圾箱与恢复
- 延后显示：任务可以提前 N 天或一个月进入列表，日历中始终可见
- 浅色与深色主题
- 公历、农历、二十四节气、中国传统节日与法定节假日
- 法定节日当天和假期期间使用不同颜色区分
- 同一天存在多个节日时尽量完整显示
- 可选 AI 总结：支持文字、图片、PDF、Word、Excel、PPTX、文本等资料
- 一次资料可提取多件待办，并支持逐项添加或一键添加全部
- AI 自动翻译开关，可把非中文内容整理为中文
- 便携数据：任务保存在程序旁的 `data/data.json`

## 开发

需要 Node.js 与 npm。

```powershell
npm install
npm start
```

打包 Windows x64 便携版本：

```powershell
npm run package
```

构建结果会写入 `dist/`。产物没有购买 Windows 代码签名证书，首次运行时可能出现 SmartScreen“未知发布者”提示。

## 项目结构

- `main.cjs`：Electron 主进程、窗口、数据存储与 AI 请求
- `index.html` / `app.js`：桌面浮窗
- `manager.html` / `manager.js`：管理中心
- `date-picker.*` / `time-picker.*` / `defer-picker.*`：自定义日期、时间与延后控件
- `calendar-info.js` / `lunar.js`：农历、节气与节假日信息
- `lib/`：Windows 桌面层附着相关代码
- `floating*.css` / `manager*.css` / `style.css`：界面样式

## 数据与隐私

默认数据文件为程序旁的 `data/data.json`，不会自动上传。AI 总结是可选功能，只有在管理中心配置接口并主动点击总结时，输入内容才会发送到你配置的接口。

API Key 使用 Electron `safeStorage` 加密后独立保存在 `data/ai-key.dat`，并保留 `data/ai-key.backup.dat` 备份。界面和 IPC 不返回明文 Key。不要把 `data/`、`ai-config*.json`、`ai-key*.dat` 或本地生成的安装包提交到仓库。

## AI 接口

在“管理中心 → 设置 → AI 总结”中填写：

- OpenAI 兼容接口地址，例如 `https://api.openai.com/v1`
- 模型名称
- API Key

接口需要兼容 `POST /chat/completions`。AI 总结为可选功能，关闭时程序仍可完全离线使用。

可添加 PDF、DOC/DOCX、XLS/XLSX/ODS/CSV、PPTX、ODT、RTF、TXT、Markdown、JSON、XML、YAML 等资料；单个文件上限 20MB，一次最多 5 个。扫描版 PDF 如果没有文字层，可把页面截图作为图片添加。

## 许可

源代码使用 [MIT License](LICENSE)。

桌面层附着代码改编自 MIT 许可的 [Dayboard](https://github.com/nowsummer/Dayboard)；农历与节日数据使用 [lunar-javascript](https://github.com/6tail/lunar-javascript)。第三方代码、图片与字体的具体归属见 [ATTRIBUTIONS.md](ATTRIBUTIONS.md)。

MIT 许可仅覆盖本项目有权许可的代码与内容；第三方资源仍归其各自权利人所有。
