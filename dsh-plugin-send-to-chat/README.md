# dsh-plugin-send-to-chat

在 DSH Web GUI 的侧边栏 **工作区文件** 中，把文件 / 目录 / 选中的行范围一键送进对话框，省去手敲路径。

## 功能

| 操作 | 结果 |
|---|---|
| 在工作区文件树中 **右键点击文件** | 菜单 → 发送到对话框 → 插入 `@src/app.ts` |
| 在工作区文件树中 **右键点击目录** | 菜单 → 发送到对话框 → 插入 `@src/utils/` |
| 在右侧文本 / 代码预览里 **选中若干行后右键** | 菜单 → 发送到对话框（第 10-20 行）→ 插入 `@src/app.ts#10-20` |

- 路径按 `@` 引用格式生成：工作区相对路径；含空格时按语法写成 `@"my file.txt"`；目录带结尾 `/`，与 DSH 自带的 `@` 补全菜单完全一致。
- 插入位置是**当前可见 / 聚焦的那个输入框**（主对话区或右侧边栏 chat 标签）；若都不可用则优先主对话区。
- **只插入，不自动发送**，你可以继续补充问题再自己回车。
- 右键菜单里会同时显示将要插入的那段 `@引用` 原文，方便确认。

## 两种目标的插入形式（重要）

| 目标 | 插入形式 | 原因 |
|---|---|---|
| 整个文件 / 目录 | **真正的引用 chip**（`ReferenceChipNode`，与 `@` 菜单选择文件完全相同） | `@path` 本身就是合法的文件引用，chip 可点击、可预览 |
| 行范围 `#n-m` | **纯文本** `@path#10-20` | DSH 的 `@file` 语法里没有行范围，`#n-m` 不属于引用的一部分；做成 chip 点击时会去找一个名为 `path#10-20` 的文件而失败。写成纯文本，模型照样能读到并理解行范围 |

两种形式模型看到的文本都是 `@path` / `@path#n-m`。

## 安装

本插件已作为一个 **DSH bundle** 安装到 desktop profile（`<DSH_HOME>/profiles/desktop/package.json`）：

```jsonc
{
  "dependencies": { "dsh-plugin-send-to-chat": "link:D:/plugins/dsh-plugin-send-to-chat" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-plugin-send-to-chat"] } }
}
```

也可以从 **设置 → 插件** 里切换启用状态，或卸载。

手工安装（不使用插件管理器）：

```yaml
# <DSH_HOME>/profiles/desktop/cordis.patch.yml
- insert:
    - id: send-to-chat
      name: 'dsh-plugin-send-to-chat'
```

`insert` 的 `name` 也接受**绝对路径**，例如 `name: 'D:/plugins/dsh-plugin-send-to-chat'`，此时无需 `pnpm install`。

改完客户端代码后刷新页面即可生效；改 `package.json`（尤其是 `exports`）必须重启 DSH。

> 安装到其他机器、以及「只装其中一个插件」的说明见仓库根部的 [`../README.md`](../README.md)；
> DSH 内部实现结论见 [`../docs/dsh-plugin-dev-notes.md`](../docs/dsh-plugin-dev-notes.md)。

## 安装到另一台电脑

插件的全部实现都在 `lib/` 里，**没有任何运行时依赖**（`react` 与 `@deepseek-ai/dsh-client-ui-primitives` 由 DSH 客户端自身作为基线模块提供），因此跨机器安装不需要联网、不需要 registry、不需要 `pnpm install`。

### 方法 A：拷贝文件夹 + 运行安装脚本（推荐，已验证）

1. 把整个 `dsh-plugin-send-to-chat` 文件夹拷到目标电脑，例如 `D:\plugins\dsh-plugin-send-to-chat`。
2. 在该文件夹里执行：

   ```powershell
   node install.mjs              # 自动选择 $DSH_PROFILE，否则用 desktop
   node install.mjs web          # 指定 profile
   node install.mjs --dry-run    # 只看会写入什么，不动文件
   ```

   脚本会往该 profile 的 `cordis.patch.yml` 追加一行，并在改动前自动备份：

   ```yaml
   - insert:
       - id: send-to-chat
         name: 'D:/plugins/dsh-plugin-send-to-chat'
   ```

3. 重启 DSH；若 DSH 已在运行，profile 会热重载，刷新一次页面即可。

脚本是幂等的：目标 profile 里已有 `send-to-chat` 行（无论来自本脚本还是来自 bundle 安装）时会直接跳过，不会重复挂载。

### 方法 B：手写补丁行

不想用脚本的话，自己往 `<DSH_HOME>/profiles/<profile>/cordis.patch.yml` 追加方法 A 里那段 YAML 即可。`name` 支持三种写法：**绝对路径**、`file://` URL、或包名（包名要求该包已能被解析到）。

### 方法 C：走插件管理器（可从界面开关/卸载）

拷贝文件夹后，在 DSH 里用插件管理器以该**绝对路径**作为 spec 安装；它会把依赖写成链接并登记到 `dsh.profile.bundles`，之后能在 设置 → 插件 里启停和卸载。**这是最省事、也最常用的方式。**

### 方法 D：打包传递

用 `npm pack` 生成 tgz（构建产物不纳入版本控制，`.gitignore` 已忽略 `*.tgz`），传到目标机器后解压
（会解出 `package/` 目录，建议重命名成 `dsh-plugin-send-to-chat`），再按方法 A 运行 `install.mjs`。

### 方法 E：发布到 npm / 私有 registry（多台机器最省事）

包目前是 `"private": true`，会阻止 `npm publish`。要发布就先去掉这一行，然后：

```powershell
npm publish --access public      # 或推私有 registry
```

其他机器上以包名安装即可（`install_bundle` spec 用 `dsh-plugin-send-to-chat`）。注意这种方式要求目标机器能访问该 registry。

### 兼容性注意 ⚠️

| 项 | 要求 |
|---|---|
| cordis | `peerDependencies` 声明 `~4.0.4`（DSH 0.2.0-rc.2 的 `app.asar` 内即 4.0.4）。DSH 升级到 cordis 4.1+ 时插件管理器会拒绝安装 |
| DSH 客户端版本 | 插件依赖宿主发布的 `data-*` 锚点（`data-files-path`、`data-textpreview-line`、`data-code-preview` 等）与 `ctx.get('conversation').input` 接口。本插件针对 **0.2.0-rc.2** 开发；目标机器 DSH 版本差异较大时需要重新核对 `lib/client.js` 顶部的选择器常量 |
| Node | 安装脚本用 `install.mjs`，需要 Node 18+（仅用内置模块） |

## 插件列表里的显示文字

**设置 → 插件** 卡片上的标题与说明来自 `locale/<语言>.json` 里的 `meta.title` / `meta.description`（由 `@deepseek-ai/dsh-app-boot` 的 `readPluginMeta` 读取，Client 按当前语言解析）：

```jsonc
// locale/zh.json
{ "meta": { "title": "发送到对话框", "description": "在侧边栏工作区文件中，把文件、目录或选中的行范围以 @ 引用发送到对话框。" } }
```

几个约束（不满足会静默回退，或被记为元信息诊断）：

- `locale/` 必须在 `exports` 里导出（`"./locale/*.json"`），否则 DSH 根本解析不到。
- 文件名必须是语言 id（`en`、`zh`、`zh-CN` …），该目录下**每个 `.json` 都会被当成词典**。
- 必须提供 `en`（English 是回退基准）；`meta.title` / `meta.description` 必须是非空字符串。
- 未提供本地化时，标题回退到 `package.json.name`，说明回退到 `package.json.description`。
- 卡片图标也走同一套元数据：在 `package.json` 里加 `"icon": "icon.svg"`（相对路径，SVG/PNG/JPEG/WebP，≤256 KiB，须在包目录内）。

改完可在任意机器上自检 DSH 实际读到的内容：

```powershell
node verify-meta.mjs          # 打印解析结果与各语言下的最终文案
```

### 改动何时生效 ⚠️

| 改动 | 生效方式 |
|---|---|
| `lib/client.js`（浏览器端逻辑） | 刷新页面 |
| `package.json` 的 `icon` | 重新进入 设置 → 插件（`package.json` 内容是每次现读的） |
| **`package.json` 的 `exports`**（如新增 `"./locale/*.json"`） | **必须重启 DSH** |
| `locale/*.json` 的**文字内容**（不动 `exports`） | 重启后即可正常热改；改完重新进入插件页即可 |

原因：DSH 通过 Node 的**内部 ESM 解析器**读取插件元数据（`readPluginMeta` → `optionalResourcePath` → `ModuleLoader.fromInternal().resolveSync`），而该解析器**缓存 package.json 的 `exports` 映射，且不随文件变化失效**。

实测（同进程 vs 新进程）：

```
1) resolve package.json                              OK
2) resolve locale/en.json（exports 里还没有该子路径）  FAIL ERR_PACKAGE_PATH_NOT_EXPORTED
   （磁盘上写入 "./locale/*.json" 之后）
3) 同进程再解析                                       FAIL ERR_PACKAGE_PATH_NOT_EXPORTED   ← 缓存
4) 全新进程解析                                       OK
```

所以「从没有本地化到有本地化」这一步必须重启一次；之后只改 `locale/*.json` 里的文案（`exports` 不变）就不需要了。

## 实现要点

DSH 自带的工作区文件树**刻意没有右键菜单**（其 README 把 "context menu" 列在 Known Limitations 里），也没有暴露行级操作的 Slot；而每个 keyed Slot 只允许一个占用者，插件无法包装它们。因此本插件采用：

1. **DOM 读取（只读，不修改宿主 DOM）** —— 依赖宿主稳定发布的锚点：
   - 文件树行：`li[data-files-entry][data-files-path]`，根目录：`[data-files-root]`
   - 预览：`[data-textpreview-state="text"]`、`[data-textpreview-url]`、`[data-textpreview-plain] [data-textpreview-line]`、`[data-code-preview] .line`
2. **选区 → 行号** —— 用 `Range.intersectsNode` 求出行元素交集；正好停在某行开头不算选中该行。
3. **菜单 UI** —— 注册进 `shell.overlay`（框架级浮层），复用 `@deepseek-ai/dsh-client-ui-primitives` 的 `Menu`，因此外观、键盘导航、Esc/外点关闭都与原生菜单一致。
4. **插入** —— `ctx.get('conversation').input.shell(sessionId)` 拿到该会话的输入 shell：
   - 文件 / 目录：`shell.insertReference({ source: 'reference', ref, label, appearance, clipboardText }, span)`
   - 行范围：`shell.actions.insertText(text, span)`
   - `span` 来自 `shell.actions.captureInsertion()`，插入前后保证 `draftRev` 一致；`insertReference` 失败（提交中等状态）时降级为纯文本。

## 已知限制

- 行范围只在**纯文本 / 代码**预览里可用；Markdown 渲染器不暴露源码行锚点（这是 DSH 的既有行为）。
- 文件树只支持列表内的行；`other` 类型（灰色不可点）条目不提供菜单。
- 依赖宿主的 `data-*` 锚点。若 DSH 升级后改动这些属性，需要同步更新 `lib/client.js` 顶部的选择器常量。
- 路径取工作区相对路径；若目标不在当前会话工作区内，则退回绝对路径。
