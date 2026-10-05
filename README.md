# dsh-plugin

DeepSeek Harness（DSH）Web GUI 插件集。两个插件彼此独立，**可以只装其中一个**。

DSH 的插件系统目前**没有公开文档**。这里的两个插件是照着 DSH 运行时（`app.asar`）解包出的内部实现写的，
所有实测结论 —— 内部接口、宿主 DOM 锚点、Slot 规则、踩过的坑 —— 都整理在
**[docs/dsh-plugin-dev-notes.md](docs/dsh-plugin-dev-notes.md)**。动手改代码前建议先读它。

## 插件一览

| 插件 | 包名 | 一句话 |
|---|---|---|
| [发送到对话框](dsh-plugin-send-to-chat/) | `dsh-plugin-send-to-chat` | 右键文件 / 目录 / 选中的行范围，把 `@引用` 直接插进输入框 |
| [通知与提示音](dsh-plugin-notify-and-sound/) | `@local/dsh-notify-sound` | 会话完成、需要授权或选择时，右上角卡片 + 系统通知 + 提示音 |

### 发送到对话框

在侧边栏「工作区文件」里右键，或在右侧文本 / 代码预览里选中若干行后右键：

| 操作 | 插入结果 |
|---|---|
| 右键一个**文件** | `@src/app.ts` —— **真正的引用 chip**，可点击、可预览 |
| 右键一个**目录** | `@src/utils/` —— chip，图标为文件夹 |
| 在预览里选中第 10–20 行后右键 | `@src/app.ts#10-20` —— 纯文本 |

- 路径是**工作区相对路径**；含空格时按 DSH 语法写成 `@"my file.txt"`，目录带结尾 `/`，
  与 DSH 自带的 `@` 补全菜单完全一致。
- **只插入、不发送**：插完可以继续补充问题再回车。
- 插入目标是**当前可见 / 聚焦的那个输入框**（主对话区或右侧 chat 栏）；都不存在时优先主对话区。
- 右键菜单里会显示将要插入的那段原文，方便确认。
- 行范围为什么是**纯文本**而不是 chip：DSH 的 `@file` 语法不支持行范围，`@path#n-m` 不是合法引用，
  做成 chip 点击时会去找一个名为 `path#n-m` 的文件而失败。写成纯文本，模型照样能读到并理解行范围。

### 通知与提示音

会话**完成**、工具**等待你授权**、Agent **需要你选择**时提醒：

- **右上角卡片**与**系统通知**始终同时出现（同屏最多 3 张）；通知有**一个总开关**统一控制。
- **提示音**另有独立开关；音源可选 3 个内置音效或**自定义文件**（用系统原生文件选择框挑，不复制文件）。
- 全部设置都在 **设置 → 插件 → 通知与提示音** 页面里改，点「保存」**立即生效**，无需刷新；
  被改过的字段带「已修改」标记，可逐项「恢复默认」。
- 用户改动只写进 `$DSH_HOME/notify-sound.json`（只存改过的字段），其余走插件自带的默认层。

## 安装

前提：目标机器已装 DSH。两个插件都是**零运行时依赖**
（`react`、`@deepseek-ai/dsh-client-ui-primitives` 等基线模块由 DSH 客户端自身提供），
所以**不需要联网、不需要 `pnpm install`、不需要 npm registry**。

```bash
git clone https://github.com/bsgxiaobi/dsh-plugin.git
```

**只装其中一个**：只安装需要的那一个目录即可 —— 两个插件互不依赖、不共享代码，
装一个不会把另一个带出来。`git clone` 只是拿到文件，**并不等于安装**。

| 插件 | 安装单元（目录） | 包名（写进 `dsh.profile.bundles` 时用） |
|---|---|---|
| 发送到对话框 | `dsh-plugin-send-to-chat/` | `dsh-plugin-send-to-chat` |
| 通知与提示音 | `dsh-plugin-notify-and-sound/` | `@local/dsh-notify-sound`（**与目录名不同**，别混用） |

### 方式一：插件管理器（推荐）

在 DSH 里 **设置 → 插件 → 安装**，选那个目录的**绝对路径**。由 Agent 驱动时等价于：

```
plugin_manager  action=install_bundle  target=<插件目录绝对路径>
```

插件管理器会写好 `link:` 依赖并登记到 `dsh.profile.bundles`，之后可以在插件页里随时启停 / 卸载。

### 方式二：手写补丁行（不碰包管理器）

往 `<DSH_HOME>/profiles/<profile>/cordis.patch.yml` 追加一行。`name` 用**绝对路径**
（Loader 同时接受绝对路径与 `file://` URL），因此**不需要 `pnpm install`，也不要求包名可解析**：

```yaml
- insert:
    - id: send-to-chat
      name: 'D:/plugins/dsh-plugin-send-to-chat'
```

`id` 只是这一行在 Loader 里的名字，可以自己起。通知插件同理：

```yaml
- insert:
    - id: notify-sound
      name: 'D:/plugins/dsh-plugin-notify-and-sound'
```

### 方式三：安装脚本（只有「发送到对话框」自带）

```powershell
cd <插件目录>\dsh-plugin-send-to-chat
node install.mjs              # 自动取 $DSH_PROFILE，否则用 desktop
node install.mjs web          # 指定 profile
node install.mjs --dry-run    # 只打印要写入的内容，不动文件
```

它会自动往上面那个补丁文件追加「方式二」的行，**改动前先备份**，并且**幂等**
（已有 `id: send-to-chat` 就跳过，不会重复挂载）。

### ⚠️ 装完请重启 DSH

DSH 会在进程内缓存插件的模块解析结果，所以**首次挂载、以及目录被移动或重命名之后，都需要重启一次**才稳定生效。
不重启时最典型的现象是插件页退化成「包名 + 通用拼图图标」。机制与排查方法见
[开发笔记 §3.1](docs/dsh-plugin-dev-notes.md)。

## 兼容性

| 项 | 要求 |
|---|---|
| DSH | 针对 **0.2.0-rc.2**（内置 cordis 4.0.4）开发 |
| cordis | `send-to-chat` 声明 peer `@deepseek-ai/cordis: ~4.0.4`。目标机器 DSH 若内置 cordis 4.1+，**插件管理器会拒绝安装**（可用版本豁免强装，但有崩溃风险） |
| Node | 仅方式三的 `install.mjs` 与自检脚本 `verify-meta.mjs` 需要，Node 18+（只用内置模块） |
| 平台 | 通知插件的**原生文件选择框**按平台分别实现：Windows 用 PowerShell + WinForms，macOS 用 `osascript`，Linux 用 `zenity` / `kdialog`；纯 Web 端（远程访问）回退到浏览器自己的文件选择器 |

两个插件依赖的**全部是 DSH 的内部实现**（DOM 锚点、composer 插入接口、Slot 注册点），
没有任何 API 承诺。DSH 升级后最可能坏的就是这些 —— 自检顺序见开发笔记。

## 已知限制（设计取舍，不是缺陷）

| 限制 | 原因 |
|---|---|
| 行范围只在**纯文本 / 代码**预览可用，**Markdown 不支持** | DSH 的 Markdown 渲染器不暴露源码行锚点 |
| `@path#n-m` 是**纯文本**，不是可点击的引用 chip | `#n-m` 不属于 `@file` 语法，做成 chip 会去找名为 `path#n-m` 的文件 |
| 纯文本写下的 `@file.md` **不会**被渲染成 chip | DSH 的引用扫描只认 `@dir/`（尾斜杠）与补全菜单里的名字；文件引用要 chip 必须走插入接口 |
| 文件树里 `other` 类型的条目没有菜单 | 宿主把它标记为不可点击 |
| 右键菜单只在文件树行与文本 / 代码预览内出现 | 刻意收窄：其他地方保留原生右键行为（例如 trajectory 的 JSON 复制菜单） |

## 目录结构

```
.
├── dsh-plugin-send-to-chat/       宿主端 lib/index.js（空 apply）+ 浏览器端 lib/client.js
│                                  install.mjs 安装脚本、verify-meta.mjs 元数据自检
├── dsh-plugin-notify-and-sound/   宿主端 host.js + 浏览器端 client.js
├── docs/
│   └── dsh-plugin-dev-notes.md    DSH 插件平台的实测笔记（本仓库最有价值的文件）
└── tools/
    └── extract-asar.mjs           把 DSH 的 app.asar 解包成可读源码树（纯 Node，零依赖）
```

## 开发

改动何时生效：

| 改动 | 生效方式 |
|---|---|
| `lib/client.js`（浏览器端逻辑） | **刷新页面** |
| `locale/*.json` 的**文案内容**（不动 `exports`） | 重启 DSH 后即可热改 |
| `package.json` 的 `exports`（如新增子路径） | **必须重启 DSH** |
| 宿主端入口文件（`host.js` / `lib/index.js`） | **必须重启 DSH** |
| 移动 / 重命名插件目录 | **必须重启 DSH** |

原因：DSH 通过 Node 的**内部 ESM 解析器**读取插件元数据，该解析器会缓存 `package.json` 的 `exports` 映射
与 junction 的 realpath，且不随文件变化失效。

元数据自检（图标、中文标题、各语言下的最终文案）：

```powershell
node dsh-plugin-send-to-chat/verify-meta.mjs
```

查阅 DSH 内部实现（解包 `app.asar`）：

```powershell
node tools/extract-asar.mjs `
  "C:\Users\<你>\AppData\Local\Programs\DeepSeek Harness\resources\app.asar" `
  "<任意输出目录>"
```

## 许可证

根目录 `LICENSE` 为 **Apache-2.0**。
`dsh-plugin-send-to-chat/package.json` 声明的是 `MIT`，`dsh-plugin-notify-and-sound` 未单独声明 ——
若要统一，改各自的 `license` 字段，或替换根 `LICENSE`。
