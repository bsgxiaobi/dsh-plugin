# DSH 插件仓库 · 后续工作清单

> **姊妹文档**：[`MIGRATION-CHECKLIST.md`](./MIGRATION-CHECKLIST.md) —— 负责「迁移怎么做、怎么验证」。
> 本文档负责「迁移之后还剩什么没做」。
>
> 阅读本文档的会话**没有历史上下文是正常的**。§0 给出状态速览，每项都标了负责方与前置条件。

---

## 0. 状态速览

| # | 事项 | 状态 | 负责 |
|---|---|---|---|
| 1 | **`send-to-chat` 的右键功能从未被人工验证** | ⚠️ **未验证** | 需 GUI 人工确认 |
| 2 | 迁移本身（建仓库 / 移动 / 重指向 / git） | 未执行 | 待用户说「执行」 |
| 3 | 迁移决策 D1–D4 | 未决策 | 用户 |
| 4 | `web` profile 未安装插件 | 待定 | 用户 |
| 5 | 插件中文标题/说明 + 图标是否生效 | 待 DSH 重启后确认 | 用户重启 → 可自动验证 |
| 6 | `gh auth login` + 推送 GitHub | 阻塞于登录 | 用户登录 → 可自动推送 |
| 7 | `docs/dsh-plugin-dev-notes.md` 尚未落盘 | 待定 | 可自动生成（素材见清单 §7） |
| 8 | `.dsh-src-ref`（355 MB 解包源码）去留 | 待定 | 用户 |
| 9 | **`tools/extract-asar.mjs` 尚未收进仓库**（脚本目前只在 `%TEMP%`，随时可能被清理） | ⏳ **有时效** | 可自动完成 |

---

## 1. ⚠️ 最高优先：核心功能从未被人工验证

我**无法驱动浏览器**，所以插件装上并确认「已加载」之后，**实际交互行为一次都没验证过**。以下是必须人工确认的四项，任何一项不通过都要回头改 `lib/client.js`：

- [ ] **1.1** 侧边栏「工作区文件」里右键一个**文件** → 出现菜单「发送到对话框」（菜单里应显示将要插入的 `@相对路径`）→ 点击后输入框出现**引用 chip**
- [ ] **1.2** 右键一个**目录** → 菜单 → 输入框出现 `@dir/`（chip 的 appearance 应为 folder）
- [ ] **1.3** 在右侧打开一个**文本/代码**文件，拖选若干行后右键 → 菜单标题应显示「发送到对话框（第 n-m 行）」→ 点击后输入框出现 `@路径#n-m`
- [ ] **1.4** 插入目标符合预期：**当前可见/聚焦**的那个输入框（主对话区或右侧边栏 chat），都不存在时优先主对话区

**已知风险点**（若上述失败，先查这些）：

| 症状 | 首先怀疑 |
|---|---|
| 右键完全没反应 | `lib/client.js` 顶部的选择器常量与宿主实际 DOM 不符（`TREE_ROW` / `TEXT_PREVIEW` / `PLAIN_LINE` / `CODE_LINE`）。用浏览器 DevTools 检查实际属性 |
| 菜单弹出但灰掉（显示「当前没有可用的输入框」） | `activeComposer()` 没找到 `[data-composer-input]` 且 `isContentEditable` 为真的元素 |
| 点了菜单但输入框没变化 | `ctx.get('conversation').input.shell(sessionId)` 失败，或 `captureInsertion()` 的 `draftRev` 过期。浏览器 console 会有 `[send-to-chat] the composer refused the insertion` |
| 行号差一行 | 行范围用 `Range.intersectsNode` 判定，边界行为（正好停在某行开头）可能与预期差一 |
| 插入的是纯文本不是 chip | `insertReference` 返回 false 后走了降级分支（纯文本）。检查 `ui-reference` 是否挂载 |

> 复核参考：`lib/client.js` 的 `#region selectors` 区块集中了全部 DOM 锚点；§7.5（清单文档）列出每个锚点的含义。

---

## 2. 待你决策（会阻塞后续步骤）

| 编号 | 决策 | 影响 |
|---|---|---|
| **D1** | 旧路径（`D:\ai\project\dsh-plugin-send-to-chat` 等）**留不留 junction 垫片** | (a) 删掉 → 仓库最干净，但旧会话（含本次对话）从此只能当历史阅读<br>(b) 保留 → 旧会话继续可用，代价是多一层路径间接 |
| **D2** | `workspace.json` 里旧的两个 workspace 条目 | (a) 删除（日志文件保留）(b) 保留（若旧路径已删，侧边栏会出现失效工作区） |
| **D3** | `dsh-plugin-notifiy-and-sound` 目录名拼写是否改为 `notify` | 包名 `@local/dsh-notify-sound` 本来就对，只有**目录名**拼错。趁迁移改动最便宜 |
| **D4** | 是否生成 `docs/dsh-plugin-dev-notes.md` | 建议要 —— 否则下一台电脑/下一个会话要把 DSH 内部实现重挖一遍 |
| **D5** | `web` profile 是否也安装插件 | 装了的话 `web` 组合也有此功能；一条命令 `node install.mjs web` |
| **D6** | `.dsh-src-ref`（355 MB）保留还是删除 | 见 §6 |
| **D7** | 是否把 DSH 源码解包脚本收进仓库 | 见 §6.3 |

---

## 3. 待 DSH 重启后验证（无需决策，只需确认）

上一轮改动引入了 `locale/` 与 `package.json` 的 `exports` 新子路径。**Node 的内部 ESM 解析器会缓存 `exports` 映射且不随文件失效**，所以必须重启 DSH 才会生效（详见清单 §5 坑 G2）。

重启后确认：

- [ ] **3.1** `node D:\ai\project\<新仓库>\dsh-plugin-send-to-chat\verify-meta.mjs` → `languages found: en, zh`，`zh` 下 title=`发送到对话框`
- [ ] **3.2** 设置 → 插件 里该插件显示：**图标**（蓝色对话气泡箭头）+ 标题 **发送到对话框** + 中文说明
- [ ] **3.3** 若仍是英文/通用拼图图标 → 说明 `exports` 仍未生效，检查 `package.json` 的 `exports` 是否含 `"./locale/*.json"`

---

## 4. 插件改进 backlog

### 4.1 `dsh-plugin-send-to-chat`

| 项 | 说明 | 优先级 |
|---|---|---|
| **行范围 chip 化** | 目前 `@path#n-m` 是**纯文本**（设计取舍：`#n-m` 不是合法文件引用，做成 chip 点击会去找名为 `path#n-m` 的文件）。可选改进：先插文件 chip，再把 `#n-m` 插到 chip 与自动追加的空格之间 —— `captureInsertion()` 返回的 span 可手工构造成 `{start: len-1, end: len-1, draftRev}` 实现，但会增加脆弱性 | 低 |
| 菜单增加「复制路径」 | 复用同一套右键拦截，插槽 UI 已有 | 低 |
| 批量发送 | 文件树支持多选后一次插入多个引用 | 中 |
| 可配置化 | 插入后是否补空格；chip 还是纯文本；自定义菜单标题 | 低 |
| 单元测试 | 纯函数（`workspaceRelative` / `formatMention` / `formatRange` / `parseFileAddress`）容易测；DOM 部分可用 jsdom | 中 |

### 4.2 `@local/dsh-notify-sound`

> 这是用户自己的插件，本次只确认了它的存在与包元数据，**没有读过其实现**。改进项需先读代码再定。

| 项 | 说明 |
|---|---|
| 与 `send-to-chat` 共享约定 | 两者都应在 `docs/dsh-plugin-dev-notes.md` 里登记自己的插槽/事件占用，避免将来冲突 |
| 目录名拼写 | 见 D3 |

### 4.3 两个插件共同

| 项 | 说明 |
|---|---|
| 无 CI | 目前只有手工 `node --check`。可加一个 GitHub Action 跑语法检查 + `verify-meta.mjs` |
| 无 CHANGELOG / 版本策略 | 都在 `0.1.0` / `1.0.0`，无 tag |
| `private: true` | `send-to-chat` 是 `private`，无法 `npm publish`。若要走 npm 分发需去掉（见 README「方法 E」） |

---

## 5. 维护须知（DSH 升级时的影响面）

### 5.1 版本兼容

| 项 | 值 | 风险 |
|---|---|---|
| `send-to-chat` 的 peer | `@deepseek-ai/cordis: ~4.0.4` | DSH 升到 cordis 4.1+ 时**插件管理器会拒绝安装**（可用版本豁免强装，但有崩溃风险） |
| DSH 运行时（app.asar 内） | cordis 4.0.4；DSH 包 0.2.0-rc.2 | 插件针对此版本开发 |
| 注意 | `$DSH_HOME\profiles\node_modules\@deepseek-ai\cordis` 是 **4.0.1**，与 app.asar 内的 4.0.4 **不是同一份**（属于别的 profile 的依赖树）。排查版本时别被它误导 | |

### 5.2 DSH 升级后最可能坏掉的地方

本插件依赖的全是 DSH 的**内部实现**（无公开 API 承诺），按脆弱度排序：

1. **DOM 锚点**（最脆）：`data-files-path`、`data-textpreview-line`、`data-code-preview`、`data-composer-input`、`data-conversation-session`。定位方式：`lib/client.js` 的 `#region selectors`。
2. **composer 插入接口**：`ctx.get('conversation').input.shell()` / `actions.captureInsertion()` / `actions.insertText()` / `shell.insertReference()`。这些在 DSH 源码里**完全没有任何文档**。
3. **Slot 注册点**：`shell.overlay`（本插件唯一使用的注册点）。
4. **包元数据机制**：`dsh.bundle.patch` / `dsh.client` / `locale/*.json` / `package.json.icon` —— 这部分相对稳定，且有明确校验规则。

### 5.3 升级后自检顺序

```
1. plugin_manager list_plugins      → 条目 enabled + fiberPhase: active ？
2. cordis_inspect_query(client, Slots, listSubTree, {"root":"shell.overlay"})
                                    → occupants 里有 id "send-to-chat" ？
3. node verify-meta.mjs             → 元数据还能解析 ？
4. 人工跑 §1 的四项交互
```

第 2 步通过 = 宿主与浏览器端都加载成功；第 4 步失败 = DOM 锚点需要按新版实际属性更新。

---

## 6. 环境清理

### 6.1 `D:\ai\project\.dsh-src-ref`（实测 355.2 MB / 12,967 文件）

为阅读 DSH 内部实现而把 `app.asar` 解包出来的源码树。**不属于任何仓库**。

- 保留的理由：后续开发/排查插件时极为有用（本会话的全部平台知识都来自它）
- 删除的理由：355 MB，且可随时重建
- ⚠️ **重建脚本目前只在系统临时目录里**：`%TEMP%\dsh-asar-extract.mjs`（实测仍存在，1,894 字节）。Windows 清理临时文件后会丢 → 见 6.3，建议**尽快收进仓库**。

### 6.2 构建产物

- `dsh-plugin-send-to-chat-0.1.0.tgz`：已决定**不纳入 git**（§3.5 的 `.gitignore` 已含 `*.tgz`）。随时可用 `npm pack` 重建。

### 6.3 建议补进仓库

| 建议文件 | 来源 | 作用 |
|---|---|---|
| `tools/extract-asar.mjs` | **现成的**：`%TEMP%\dsh-asar-extract.mjs`（纯 Node、无依赖、~1.9 KB）。**趁它还在，尽快拷进仓库** | 把 DSH 的 `app.asar` 解包成可读源码树；换电脑后能重建 `.dsh-src-ref` |
| `docs/dsh-plugin-dev-notes.md` | 素材见 `MIGRATION-CHECKLIST.md` §7 | 见 D4 |

`tools/extract-asar.mjs` 的用法（脚本自带 usage）：

```powershell
node tools/extract-asar.mjs `
  "C:\Users\<你>\AppData\Local\Programs\DeepSeek Harness\resources\app.asar" `
  "D:\ai\project\.dsh-src-ref"
```

---

## 7. 已知限制（设计取舍，不是缺陷）

记录这些是为了避免后来者把它们当 bug 修：

| 限制 | 原因 |
|---|---|
| 行范围只在**纯文本 / 代码**预览可用，**Markdown 不支持** | DSH 的 Markdown 渲染器不暴露源码行锚点（这是 DSH 既有行为） |
| `@path#n-m` 是**纯文本**而非引用 chip | `#n-m` 不属于 `@file` 语法；做成 chip 点击会失败 |
| 纯文本 `@file.md` 不会渲染成 chip | DSH 的引用扫描只认 `@dir/`（尾斜杠）与 lexicon 内的名字；文件引用要 chip 必须走 `insertReference` |
| 文件树里 `other` 类型的条目无菜单 | 宿主把它标记为不可点击 |
| 右键菜单只在文件树行与文本/代码预览内弹出 | 刻意的收窄：其他地方保留原生右键行为（例如 trajectory 的 JSON 复制菜单） |
| 改 `package.json` 的 `exports` 必须重启 DSH | Node 内部 ESM 解析器缓存 `exports` |
