# DSH 插件开发笔记

> 这份文档记录的是**实测结论**，来源是解包 `app.asar` 读 DSH 源码 + 运行时 Inspect 验证。
> DSH 插件系统**没有官方公开文档**，这里的每一条都可能随 DSH 升级而失效 —— 文末给出升级后的自检顺序。
>
> 目标读者：将来在**这台或另一台机器**上继续改这两个插件的人（包括只有本文档、没有任何对话历史的会话）。

---

## 1. 环境事实

| 项 | 值 |
|---|---|
| `DSH_HOME` | `C:\Users\<你>\.dsh` |
| `DSH_PROFILE` | `desktop`（另有 `web`） |
| profile 目录 | `%DSH_HOME%\profiles\<profile>` |
| profile 依赖 + bundle 清单 | `<profile>\package.json` |
| profile 补丁层 | `<profile>\cordis.patch.yml` |
| workspace 注册表 | `%DSH_HOME%\storages\workspace.json` |
| 会话历史 | `%DSH_HOME%\sessions\<cwd派生桶>\<sessionId>\session.v4.jsonl.zstd` |
| DSH 运行时 | `...\DeepSeek Harness\resources\app.asar`（内含 cordis 4.0.4） |
| 解包脚本 | [`../tools/extract-asar.mjs`](../tools/extract-asar.mjs) |

### 排查手段速查

| 手段 | 用途 |
|---|---|
| `plugin_manager`（`list_plugins` / `list_bundles`） | 插件条目是否 `enabled: true` + `fiberPhase: "active"` |
| `cordis_inspect_query`（平台 `client`，provider `Slots`，method `listSubTree`，`{"root":"shell.overlay"}`） | **端到端**证明浏览器端插件已加载：`occupants` 里应有 `id: "send-to-chat"`, `active: true` |
| `cordis_inspect_query`（平台 `host`，provider `Service`，method `listService`） | 运行时服务契约 |
| `node <插件>\verify-meta.mjs` | DSH 实际会读到的插件标题 / 说明 / 图标 |
| 浏览器 DevTools | DOM 锚点是否与 `lib/client.js` 的选择器常量一致（最常用的手段） |

### 两个必须记住的平台事实

**A —— 会话的 cwd 不可变。** 每个会话的第一帧日志里写死了 `cwd`；改 `workspace.json` 不会改变已有会话的 cwd。
⟹ 想让老会话继续可用，老路径必须存在。已在会话里的 cwd 无法迁移，旧目录删掉后旧会话**只能当历史阅读**。

**B —— 会话历史桶名由 cwd 派生**（`projectKey(cwd)`，实现见 `@deepseek-ai/dsh-session-persistence-jsonl`）：
盘符冒号与路径分隔符 → `-`，非法字符 → `~XXXX`，最后套 `--…--`。
⟹ **不要手工搬动 `%DSH_HOME%\sessions\` 下的桶目录** —— 桶名必须和会话头里的 cwd 一致，搬了会话无法恢复。

---

## 2. 插件包结构

一个 npm 包可以**同时**是 bundle 和 plugin：

```jsonc
{
  "name": "my-plugin",
  "type": "module",
  "main": "lib/index.js",          // 宿主端入口，可以是空 apply
  "icon": "./icon.svg",            // 设置 → 插件 里显示的图标
  "exports": {                     // ⚠️ 改动必须重启 DSH，见 §3
    ".": { "default": "./lib/index.js" },
    "./client": { "default": "./lib/client.js" },
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./locale/*.json": "./locale/*.json",
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },   // → 可被插件管理器安装 / 启停
    "client": { "platform": "web", "inject": [ /* 需要等待的宿主服务 */ ] }
  },
  "peerDependencies": { "@deepseek-ai/cordis": "~4.0.4" }
}
```

* **bundle 的 `cordis.patch.yml` 可以插入自己**（`name: '<包名>'`），也可以插入别的包。
* `insert` 行的 `name` 接受三种形式：**包名**、**绝对路径**、`file://` URL。
  用绝对路径可以**完全免去 `pnpm install`**，这也是最省事的跨机安装方式。
* 浏览器端 bundle 必须是 `window.__ModuleLoader__.load({ id, factory })` 格式，
  `factory(require)` 内提供 `exports.apply` / `exports.inject`。参考 `lib/client.js` 的开头。
* 宿主端 `main` 可以是一个**空 apply**（`send-to-chat` 就是这样：全部功能在浏览器端）。

---

## 3. 元数据（图标 + 中文标题/说明）与 `exports` 缓存

* `icon` 指向的图片由 DSH 现读；`locale/en.json`、`locale/zh.json` 提供本地化标题与说明。
* `verify-meta.mjs` 可以离线打印「DSH 实际会读到的元数据」，改完先跑它。

**坑（G2）：改 `package.json` 的 `exports` 必须重启 DSH。**
DSH 通过 Node **内部 ESM 解析器**读插件元数据
（`readPluginMeta` → `optionalResourcePath` → `ModuleLoader.fromInternal().resolveSync`），
该解析器**缓存 `package.json` 的 `exports` 映射且不随文件变化失效**。
实测：进程内新增 exports 后仍返回 `ERR_PACKAGE_PATH_NOT_EXPORTED`，新进程才正常。

| 改动 | 生效方式 |
|---|---|
| `lib/client.js`（浏览器端逻辑） | 刷新页面 |
| `package.json` 的 `icon` | 重进插件页（manifest 内容是每次现读的） |
| **`package.json` 的 `exports`** | **必须重启 DSH** |
| `locale/*.json` 的**文案内容**（不动 `exports`） | 重启后即可热改 |
| **宿主端入口文件**（`host.js` / `lib/index.js`） | **必须重启 DSH**（入口解析在进程内缓存，重新启用同一 bundle 不会重新解析） |

### 3.1 坑（G2b）：迁移插件目录后，插件页会显示成「包名 + 通用拼图图标」

**症状**：把插件目录搬到新路径、profile 的 junction 也重指向了，刷新插件页却**只看到包名**，
没有中文标题、没有说明、图标是通用拼图。**这与 `exports` 写没写无关**（`verify-meta.mjs` 会照常通过）。

**成因**：Node 的模块解析器在**进程内缓存了 junction 的 realpath**。运行中的 DSH 仍然认为
`dsh-plugin-send-to-chat` 住在**旧目录**，于是去 `<旧目录>\locale\en.json` 找元数据；
旧目录已被删 → `ENOENT` → `optionalResourcePath` 吞掉错误返回 `undefined` →
`readPluginMeta` 因 title/description/icon 全空而**返回 `undefined`**
（见 `@deepseek-ai/dsh-app-boot` 的 `readPluginMeta` / `missingResource`）→
插件管理器只好回退成 `name` + 通用图标。

**识别方法**（新进程 vs 旧进程对照，一跑就分晓）：新进程能解析出元数据、而已删的旧路径解析出 `undefined`，
就说明是缓存陈旧，不是包的问题。

**修复**：重启 DSH。**或者**（不重启时的临时解）把旧路径重建为指向新目录的 **junction 垫片** ——
缓存里的旧路径重新存在，读取即落到新内容。垫片不是副本，不违反「只有一份代码」。

**通用结论**：**只要插件目录被移动/重命名过，就必须重启 DSH**；改 `exports`、移动目录、换 junction 目标
三者都属于「解析结果被进程缓存住」的情形。


---

## 4. 浏览器端可用模块

`react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-store`
等属于**基线**，可以直接 `require`，**不必**写进 `dsh.client.external`。
非基线模块必须写进 `external`，否则浏览器端会加载失败。

---

## 5. Slot 体系

* 四种 kind：`single` / `list` / `keyed` / `chain`。
* **「声明即独占」**：keyed slot 的每个 key 只允许一个占用者 ⟹ 插件**无法包装**别人的 slot 内容。
  想加东西只能在别人声明的 list slot 里**追加**，或自己往 `shell.overlay` 这类框架级浮层里画。
* `ctx.slots.inject(key, cb)` 用于等待 slot 被声明后再注册。

已确认可用的注册点：

| Slot | kind | 含义 |
|---|---|---|
| `shell.overlay` | root / list | 框架级浮层，适合自绘右键菜单（`send-to-chat` 唯一使用的注册点） |
| `sidebar.right.tab.files.actions` | session / list | 文件页工具栏 |
| `sidebar.right.tab.document.actions` | session / list | 预览页工具栏 |
| `conversation.input.overlay` | session / list | 输入框浮层 |
| `conversation.composer.dock` | session / list | 输入框停靠区 |

---

## 6. Composer（输入框）插入接口

DSH 源码里**完全没有任何文档**，但通道可用：

```js
const conversation = ctx.get('conversation');
const shell = conversation.input.shell(sessionId);      // 该会话的输入 shell
const span  = shell.actions.captureInsertion();          // { start, end, draftRev }

shell.actions.insertText(text, span);                    // 纯文本（带 undo + rev CAS）
shell.insertReference({                                  // 插入真正的「引用 chip」
  source: 'reference',
  ref: '@src/app.ts',
  label: 'app.ts',
  appearance: 'file',        // 'file' | 'folder'
  clipboardText: '...'
}, span);
shell.notify(level, text);                               // 用户可见提示
```

* `captureInsertion()` 返回的 `draftRev` 是 CAS 版本号；草稿在期间被改过，插入会被拒绝
  （`send-to-chat` 会打印 `[send-to-chat] the composer refused the insertion`）。
* 插入目标应当是**当前可见 / 聚焦**的那个输入框；都不可用时优先主对话区。

---

## 7. 宿主 DOM 锚点（只读，**不要修改宿主 DOM**）

| 锚点 | 含义 |
|---|---|
| `li[data-files-entry][data-files-path]` | 工作区文件树的一行（`entry` = `file`/`directory`/`other`；`path` = 绝对路径）。注意表头的 `PathLabel` 也带 `data-files-path`，须靠 `li` + `data-files-entry` 排除 |
| `[data-files-root]` | 文件树的根（= 会话 cwd） |
| `[data-textpreview-state="text"]` | 已加载的文本 / 代码预览 |
| `[data-textpreview-url]` | 资源地址 `dsh-resource://file/session/<sessionId>/<相对路径>` |
| `[data-textpreview-path]` | 预览文件显示的路径 |
| `[data-textpreview-plain] [data-textpreview-line="n"]` | 纯文本渲染器的第 n 行 |
| `[data-code-preview] .line` | 代码渲染器的一行（序号 = 1-based 行号） |
| `[data-composer-input]` | Lexical 编辑器根（`isContentEditable` 为真才可插入） |
| `[data-conversation-session]` | 会话容器，属性值 = sessionId |

`lib/client.js` 的 `#region selectors` 区块集中了全部锚点常量 —— DSH 升级后**先看这里**。

---

## 8. `@` 引用语法（DSH 既有行为）

* `dsh-file-reference` 只定义 `@path` 与 `@"path with spaces"`；**结尾 `/` 表示目录**。
* **不支持行范围**：`@path#n-m` 不是合法引用。
* 纯文本 `@file.md` **不会**被渲染成 chip（扫描只认 `@dir/` 与 lexicon 内的名字）；
  文件引用要 chip 必须走 `shell.insertReference()`。

---

## 9. 工作区与会话持久化

* `%DSH_HOME%\storages\workspace.json` 记录 workspace（id / path / title / sessionIds）。
* **坑（G5）**：该文件被 DSH 载入内存，**运行中修改会被写回覆盖** ⟹ 只能在 DSH 停止时改。
* 删除 workspace 条目**不会**删除会话历史文件，只是历史不再出现在侧边栏。
* 一个 workspace 可以开多个会话；但**已有会话无法合并**（cwd 写死在会话头里）。

---

## 10. 已知限制（设计取舍，不是缺陷）

| 限制 | 原因 |
|---|---|
| 行范围只在**纯文本 / 代码**预览可用，**Markdown 不支持** | DSH 的 Markdown 渲染器不暴露源码行锚点 |
| `@path#n-m` 是**纯文本**而非引用 chip | `#n-m` 不属于 `@file` 语法；做成 chip 点击会去找名为 `path#n-m` 的文件而失败 |
| 纯文本 `@file.md` 不会渲染成 chip | 见 §8 |
| 文件树里 `other` 类型的条目无菜单 | 宿主把它标记为不可点击 |
| 右键菜单只在文件树行与文本 / 代码预览内弹出 | 刻意收窄：其他地方保留原生右键行为（例如 trajectory 的 JSON 复制菜单） |
| 文件树**本来就没有**右键菜单，也没有行级 Slot | `dsh-client-ui-sidebar-files` 的 README 把 context menu 列在 Known Limitations ⟹ 只能靠 §7 的 DOM 锚点自己实现 |
| `plugin_manager` 的 `list_bundles` **不含** UI 展示元数据（`meta`） | 要看本地化标题 / 说明得靠 GUI 或 `verify-meta.mjs` |

---

## 11. DSH 升级后怎么办

按**脆弱度**排序（越靠前越容易坏）：

1. **DOM 锚点**（最脆）：`data-files-path`、`data-textpreview-line`、`data-code-preview`、`data-composer-input`、`data-conversation-session`
2. **composer 插入接口**：`input.shell()` / `captureInsertion()` / `insertText()` / `insertReference()`
3. **Slot 注册点**：`shell.overlay`
4. **包元数据机制**：`dsh.bundle.patch` / `dsh.client` / `locale/*.json` / `package.json.icon`
   —— 这部分相对稳定，且有明确校验规则

自检顺序：

```
1. plugin_manager list_plugins     → 条目 enabled + fiberPhase: active ？
2. cordis_inspect_query(client, Slots, listSubTree, {"root":"shell.overlay"})
                                   → occupants 里有 id "send-to-chat" ？
3. node verify-meta.mjs            → 元数据还能解析 ？
4. 人工跑四项交互：
   - 右键文件 → 菜单 → 点 → 输入框出现引用 chip
   - 右键目录 → 输入框出现 @dir/
   - 预览里选中若干行后右键 → 菜单标题带行号 → 输入框出现 @path#n-m
   - 插入目标是当前可见 / 聚焦的输入框
```

第 2 步通过 = 宿主与浏览器端都加载成功；第 4 步失败 = DOM 锚点需要按新版实际属性更新。

**版本兼容**：`send-to-chat` 的 peer 是 `@deepseek-ai/cordis: ~4.0.4`（DSH 0.2.0-rc.2 内即 4.0.4）。
DSH 升到 cordis 4.1+ 时插件管理器会拒绝安装（可用版本豁免强装，但有崩溃风险）。
注意 `%DSH_HOME%\profiles\node_modules\@deepseek-ai\cordis` 是 **4.0.1**，属于别的 profile 的依赖树，
**与 app.asar 内的 4.0.4 不是同一份** —— 排查版本时别被它误导。

---

## 12. 两个插件各占了什么

登记在这里，避免将来冲突：

| 插件 | 宿主端 | 浏览器端 | 占用的 Slot | 其它副作用 |
|---|---|---|---|---|
| `dsh-plugin-send-to-chat` | `lib/index.js`（空 apply） | `lib/client.js` | `shell.overlay`（list，order `1000`） | 在**文件树行**与**文本/代码预览**内拦截 `contextmenu`；不修改宿主 DOM |
| `@local/dsh-notify-sound` | `host.js`（设置读写、系统通知、原生文件选择框、提供 `/plugin-notify-sound/*` HTTP 路由） | `client.js` | 通知卡片 + 设置页签 | 写 `%DSH_HOME%\notify-sound.json`（用户配置）与 `%DSH_HOME%\notify-sound-sounds\`（自定义音效副本） |
