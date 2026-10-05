# 通知与提示音 / Notifications and sounds

会话**完成**时，**DSH 右上角**与 **Windows 右下角**同时出现任务完成提示卡片，并播放提示音；Agent **需要你选择或授权**时同样提醒（右上角为 DSH 内卡片，右下角为 Windows 系统通知，需浏览器授权）。

- **一个总开关**控制通知（会话完成 / 需要授权 / 需要选择三种一起）；提示音另有**独立开关**。
- 右上角卡片与 Windows 右下角系统通知**始终同时出现**（不再各自开关），同屏最多 3 张。
- 提示音音源可**手动配置**：3 个内置音效 + 1 个自定义文件，自定义文件用**系统文件选择框**挑。
- 全部设置都能在**页面**上改：**设置 → 插件 → 通知与提示音**。

> **目录名与包名不同**：目录是 `dsh-plugin-notify-and-sound`，包名是 `@local/dsh-notify-sound`。
> bundle 清单与 `link:` 依赖用的是**包名**，按路径安装时用**目录**，别混用。
> 安装说明见仓库根部的 [`../README.md`](../README.md)；DSH 内部实现结论见
> [`../docs/dsh-plugin-dev-notes.md`](../docs/dsh-plugin-dev-notes.md)。

## 安装

由 Harness 的 `plugin_manager` 安装本目录为 bundle（安装后即生效，无需重启）：

```
plugin_manager action=install_bundle target=<本目录绝对路径>
```

安装后立即生效。此后若修改了 **Host 半边**（`host.js`），需要重启桌面端才会加载新的模块版本——Host 的插件入口解析在进程内缓存，重新启用同一 bundle 不会重新解析入口文件。

## 配置

打开 **设置 → 插件 → 通知与提示音**（该页签与「插件列表」并列），分三组、共 6 项：

| 分组 | 项 | 默认 | 说明 |
|---|---|---|---|
| 通知 | `notify` | `true` | 总开关：会话完成（Agent 由 `running` 转为 `idle`）、工具调用等待你授权、Agent 调用 `ask_user_question` 需要你选择 |
| 通知 | `onlyWhenUnfocused` | `false` | 打开后，页面在前台时保持安静 |
| 提示音 | `sound` | `true` | 播放提示音 |
| 提示音 | `soundSource` | `chime` | 音源：`chime` / `bell` / `notify` / `custom` |
| 提示音 | `customSoundPath` | `""` | `soundSource` 为 `custom` 时使用的音频文件 |
| 通知卡片 | `toastDurationMs` | `3000` | 卡片停留时间（毫秒） |

右上角卡片与 Windows 右下角系统通知始终同时出现，同屏最多 3 张，提示音**始终满音量**（没有音量控制）——这四件事都不再各配一个开关。

- 改动先暂存在页面上，点「保存」才写入；「放弃修改」丢弃。
- 被你自己改过的字段带「已修改」标记，可单独「恢复默认」，也可「全部恢复默认」；还没保存的改动带「未保存」标记。
- 保存后**立即生效**（Host 会把新设置推给所有已打开的页面），无需刷新。

存储位置分两层：

| 层 | 位置 | 作用 |
|---|---|---|
| 默认层 | 本 bundle 的 [cordis.patch.yml](cordis.patch.yml) 里 `notify-sound` 行的 `config` | 出厂默认值，也是「恢复默认」的落点 |
| 用户层 | `$DSH_HOME/notify-sound.json` | 只存你在页面上改过的字段 |

因此也可以直接编辑上面任一处。用户层优先，`null`（页面上的「恢复默认」）表示删掉该字段、退回默认层。旧版本里的 `notifyTurnEnd` / `notifyUserQuestion` / `notifyApproval` / `toast` / `systemNotification` / `maxToasts` / `volume` 已合并、固定或移除，写进文件会被**忽略并在下一次保存时从文件里去掉**。

### 自定义提示音

在配置页把「提示音音源」选成「自定义文件」，然后点「浏览…」：

- **桌面端（推荐）**：Host 直接在你本机弹出**系统原生文件选择框**（Windows 是 PowerShell + WinForms 的 `OpenFileDialog`，macOS 是 `osascript choose file`，Linux 是 `zenity`/`kdialog`），选完自动填入绝对路径。**Host 读取文件本身，不会复制**。
- **纯 Web 端**（浏览器不在这台机器上，例如远程访问、SSH 转发）：Host 会回答「没有原生选择框」，页面改用浏览器自己的文件选择器，选中后把文件**上传**到 `$DSH_HOME/notify-sound-sounds/` 并填入该副本的路径。

两种方式都支持 `.wav` `.wave` `.mp3` `.m4a` `.aac` `.ogg` `.oga` `.opus` `.flac` `.webm` `.aif` `.aiff`，单个文件最大 8 MiB。文件由 Host 读取后经 `/plugin-notify-sound/sound` 交给页面播放（浏览器本身无法读取本地路径），文件缺失或无法读取时自动回退到内置 `chime` 音效。也可以直接在输入框里手打绝对路径。

> 为什么不是 Electron 的 `dialog`、为什么平台的目录选择器用不了——见 [踩过的坑](#踩过的坑)。

### 内置音效

内置音效由 Web Audio 实时合成，不携带任何音频资源：

| 名称 | 听感 |
|---|---|
| `chime` | 清脆的两声铃声 |
| `bell` | 单声柔和钟声 |
| `notify` | 上行三音完成提示 |

## 实现

| 半边 | 职责 |
|---|---|
| `host.js`（Host） | 持有 `Config` 与用户设置文件；监听 `agent/status`（会话完成）、`tools/pre-execute`（`ask_user_question`）、`approval/request`（授权）；通过 `/plugin-notify-sound/events` 的 SSE 通道推送设置与通知；`/plugin-notify-sound/settings` 读写用户设置；`/plugin-notify-sound/pick-file` 打开本机原生文件选择框；`/plugin-notify-sound/upload` 接收 Web 端上传的音源；`/plugin-notify-sound/sound` 提供自定义音源 |
| `client.js`（Browser） | 在 `shell.overlay` 槽位渲染右上角通知栈；用 Web Audio 合成内置音效；播放自定义音源；调用 Notification API 发送系统通知；在 `settings.plugins.tab` 里渲染配置页，并按「原生选择框 → 浏览器选择器 + 上传」的顺序选音频文件 |

细节：

- 「需要选择」按**工具调用**识别：模型调用 `ask_user_question` 时会经过工具策略管线（`tools/pre-execute`），因此不依赖具体是哪一种 UI 问答服务在回答。若某个组合另外广播 `user-questions/request` 事件，两条信号会去重，只通知一次。
- 设置**不走平台的设置命名空间**，配置页读写的 `/plugin-notify-sound/settings` 是本插件自己的路由，落盘在 `$DSH_HOME/notify-sound.json`（原因见 [踩过的坑](#踩过的坑)）。
- 配置页注册在 `settings.plugins.tab`，且注册**不依赖任何可选服务**（原因见 [踩过的坑](#踩过的坑)）。
- 「会话完成」只在 `running → idle` 跳变时触发；Agent 创建时的初始 `idle` 不触发。插件激活时若 Agent 已在运行，会从实时 Agent 注册表补记该状态，所以那一次会话结束同样会通知。
- 子会话（subagent / workflow 子代理）完成时**不**通知，避免刷屏。
- 通知卡片与配置页只在 `--dsw-alias-*` 主题 token 上取色，浅色/深色主题都正确。
- 两处 UI 都自带错误边界：某个卡片或配置页渲染失败只会少那一块，不会让整个槽位条目消失。
- 浏览器自动播放策略要求页面先有过一次用户交互（例如发送过一条消息）后才允许发声。

## 踩过的坑

这里记下开发过程中真正花掉时间的坑，每条都是**在这个部署上实测到的**，不是推测。目标机器是 Windows 桌面端（`DSH_PROFILE=desktop`，GUI 在 `http://127.0.0.1:19387`）。

### 一、平台契约：别信目录，要信安装目录里的代码

- **Inspect 给出的 Service / Event 目录不等于当前安装版本。** 目录里列了 `user-questions/request`、`uiWorkspace.pickDirectory`，实测**都不存在**（前者在已安装代码里 0 处命中，而 `agent/status` 26 处、`approval/request` 42 处）；反过来 `ctx.workspaces.listDirectory` 真实存在，目录里却没列。仓库里那份 `.dsh-src-ref` 是**另一个版本**（0.2.0-rc.2 vs 已装的 0.1.0-rc.7），不能当权威。
  **对策**：一切以 `$DSH_HOME/profiles/node_modules/@deepseek-ai/*` 里的实际代码为准；grep 计数是便宜又可靠的判据。
- **平台没有挂载 settings provider。** `listConfigs name=@deepseek-ai/dsh-settings-file` 返回 **0 条**，只有抽象服务定义行（`status: absent`）。没有 provider → `ctx.inject(['settings'])` 永不回调 → 任何命名空间都进不了 `settings.describe()` → 绑定命名空间的界面必然显示「当前部署无法提供这些设置。」。这也解释了为什么 `$DSH_HOME/settings.yaml` 从来没被创建过（旁边那个 `settings.yaml.imported` 是迁移残留）。
  **对策**：本插件自带存取（`/settings` 路由 + `$DSH_HOME/notify-sound.json`），不依赖可选服务。
- **`settings.plugin.item` 的那个「可配置插件」页签在本部署没有注册**，所以没有「插件详情里直接配」的位置。
  **对策**：占用 `settings.plugins.tab`（「设置 → 插件」里的一个页签，与「插件列表」并列）。
- **有些实现打包在 `app.asar` 里，读不到。** 例如「应用配置已损坏，禁用所有三方插件或重启」这句文案，在可读的运行时包里搜不到。
  **对策**：这类问题只能靠用户提供原文 + F12 Console 才能定位，别硬猜。

### 二、插件机制

- **本地 link 安装的 bundle 解析不到裸 `@deepseek-ai/*`。** 本地目录被装成 linked layer（junction），从该文件往上找 `node_modules` 永远到不了安装的运行时表，于是 `import('@deepseek-ai/schemastery')` 直接失败（`Config` 报 `absent`）。
  **对策**：先用绝对路径从 `$DSH_HOME/profiles/node_modules/<pkg>` 加载（依次试 `lib/index.mjs`、`lib/index.js`、`lib/index.cjs`），再退回裸标识符；并且 `DSH_HOME` 之外再兜一个 `~/.dsh`。
- **Host 半边的入口模块在进程内缓存。** 改了 `host.js`（哪怕只是改个文件名）都必须**重启桌面端**；重新启用同一 bundle 不会重新解析入口。**Browser 半边**（`client.js`）是按内容哈希重新提供的，通常刷新页面即可（不生效就 Ctrl+Shift+R 强刷）。
  **对策**：把「改 Host 就得重启」当成硬规则；纯样式/文案改动尽量只动 `client.js`。
- **把注册包在 `ctx.inject([...])` 里，回调不触发就永久消失。** 早期版本声明依赖可选服务（`settingsScope` 等）再注册页签，结果那个回调在本部署根本不触发，页签永远不出现，而且**没有任何报错**。
  **对策**：注册不依赖任何可选服务；确实需要的可选依赖用 `ctx.get(name)` 懒取。本插件的设置读写后来干脆完全绕开平台服务（见上一条），页签因此永远稳当。
- **插件自己的 `webServer` 路由在本机是无鉴权的。** 因此 `/upload` 必须自己防目录穿越（只取最后一段、替换 Windows 非法字符、校验后缀、限制 8 MiB）。

### 三、文件选择

- **平台的目录选择器只能选目录，选不了文件。** `dsh-host-directory-picker-browse` 的 `list` 里有一行 `if (!dirent.isDirectory() && !dirent.isSymbolicLink()) continue;`，普通文件全被跳过；native 那条路是 koffi 驱动 Win32 `IFileOpenDialog` 且 `SetOptions(104)` 含 `FOS_PICKFOLDERS`。整个运行时也**没有任何选文件的 API**（`pickFile` / `showOpenDialog` / `getPathForFile` 全为 0）。
- **Electron 的 `dialog` 拿不到。** 持有 web 端口的是 `DeepSeek Harness.exe` 的一个**没有 `--type=` 的子进程**，父进程才是 Electron 主进程——即主进程用 `ELECTRON_RUN_AS_NODE=1` 把它当纯 Node 跑。这种模式下 `require('electron')` 只返回可执行文件路径，没有 API；并且全运行时**零处**使用 Electron。
  **对策**：沿用平台自己的思路——**spawn 一个子进程去开系统原生框**（Windows 用 `powershell -STA` + WinForms `OpenFileDialog`，macOS `osascript`，Linux `zenity`/`kdialog`）。子进程的**第一个窗口会被 Windows 自动激活**，这正是平台注释里写的理由。
- **原生框会开在 Host 那台机器的屏幕上。** 远程浏览器、SSH 转发的场景下，弹框会出现在别人面前。
  **对策**：绑定 host 不是 loopback、或存在 `SSH_CONNECTION`/`SSH_TTY` 时直接回答「不可用」，页面改用浏览器文件选择器 + 上传。
- **同名文件被替换后，浏览器会继续播放缓存的音频。**
  **对策**：音频 URL 带一个 revision（路径 + 上传计数），随设置帧一起下发。
- **手写浏览面板的教训。** 第一版自己写了个目录浏览面板（因为平台不给文件），能用但交互远不如系统框；确认 Electron 走不通后，改回「原生框 + Web 上传」两条路，代码反而更少。

### 四、通知判定

- **「会话完成」必须是 `running → idle` 的边沿**：Agent 创建时的初始 `idle` 不能算；插件激活时已经在跑的 Agent 要从实时注册表补记一次，否则第一次完成会漏。
- **子会话（subagent / workflow）也要排除**（`session.header.parentSession !== undefined`），否则刷屏。
- **提问去重的窗口不能在通知关闭时推进。** 原先 `noticeQuestion` 先更新时间戳再判断是否广播，于是「通知关闭期间来的提问」会占用窗口，导致重新打开通知后 2 秒内的第一次提问被吞掉。
  **对策**：只在真正广播时才记录时间戳。

### 五、前端渲染

- **flex 行里的按钮必须 `flex:0 0 auto` + `white-space:nowrap`。** 否则空间不足时浏览器会优先压缩按钮，「浏览…」被压成三行——这是最后才暴露的问题。该被压缩的是输入框（`flex:1 1 auto; min-width:0`）。
- **只使用 `--dsw-alias-*` 主题 token**，未认知的 token 不会报错、只是静默失效，浅色/深色主题各有各的错法。
- **每张卡片、每个面板都包一层错误边界**：一个卡片渲染失败只该少一张卡片，不该让整个槽位条目消失。
- **浏览器自动播放策略**要求页面先有过一次用户交互（比如发过一条消息）才允许发声——首次测试「没声音」先查这个，别急着改代码。

### 六、开发与测试流程（我自己的事故）

- **自动化测试里那条真能打开原生框的路径，必须加守卫（SSH / 非 loopback）。** 有一次验证脚本漏了守卫，**真的在用户屏幕上弹出了系统文件选择框**，只能事后杀进程。凡是能走到原生框的测试，要么加守卫，要么不写进自动化。
- **用 pwsh 构造要交给子 PowerShell 的脚本时，外层 shell 会吃掉 `$`。** 我因此得到过一份 `title: `（空）却仍然退出码 0 的「通过」结果，差点误判。
  **对策**：用单引号 here-string 或写成 `.ps1` 文件再 `-File` 执行。
- **`child_process` 用 pipe 捕获输出在受限沙箱下会 EPERM**（命名管道被禁）。这是运行环境的限制，不是插件问题；插件本身跑在桌面端进程里不受此限。

### 快速自查表

| 现象 | 最可能的原因 |
|---|---|
| 页签出现了，但显示「当前部署无法提供这些设置。」 | 平台没挂载 settings provider，绑定命名空间不可用——用自带路由 |
| 页签完全没出现，且无报错 | 注册被包在 `ctx.inject([...])` 里，回调没触发 |
| 改了 `host.js` 没生效（连报错都没有） | Host 入口模块在进程内缓存，需重启桌面端 |
| `Config` 一直是 `absent` | 裸 `@deepseek-ai/*` 导入失败——改用绝对路径加载运行时表 |
| 通知不触发 | 监听的事件在本版本不存在（先 grep 计数），或总开关 `notify` 关着 |
| 首次没有声音 | 浏览器自动播放策略需要先有一次用户交互 |
| 自定义音源换了文件却还是旧声音 | 音频 URL 需要 revision，否则走缓存 |
| 页面上「全部恢复默认」在没有可见改动时也出现 | 用户层文件里有旧版本残留的字段——读取时会按现有字段过滤 |
| 按钮文字被压成多行 | flex 行里按钮缺 `flex:0 0 auto` + `white-space:nowrap` |

## 卸载

```
plugin_manager action=remove_bundle target=@local/dsh-notify-sound
```

用户设置文件 `$DSH_HOME/notify-sound.json` 与上传音源的目录 `$DSH_HOME/notify-sound-sounds/` 不会被自动删除，需要时手动移除。
