# DSH 插件仓库 · 后续工作清单

> **姊妹文档**：[`MIGRATION-CHECKLIST.md`](./MIGRATION-CHECKLIST.md) —— 负责「迁移怎么做、怎么验证」。
> 本文档负责「迁移之后还剩什么没做」。
>
> 阅读本文档的会话**没有历史上下文是正常的**。§0 给出状态速览，每项都标了负责方与前置条件。

---

## 0. 状态速览

| # | 事项 | 状态 | 负责 |
|---|---|---|---|
| 1 | **`send-to-chat` 的右键功能从未被人工验证** | ⚠️ **仍未验证** | 需 GUI 人工确认（§1） |
| 2 | 迁移本身（建仓库 / 移动 / 重指向 / git） | ✅ **已执行** 2026-10-05（详见 MIGRATION-CHECKLIST.md 末尾「执行记录」） | — |
| 3 | 迁移决策 D1–D7 | ✅ **已决策** | 见 §2 |
| 4 | `web` profile 未安装插件 | ✅ 决策：**不装**（D5） | — |
| 5 | 插件中文标题/说明 + 图标是否生效 | ⏳ 待 **DSH 重启**后确认（本机 CLI 已跑通 `verify-meta.mjs`，见 §3） | 用户重启 → 可自动验证 |
| 6 | 推送 GitHub | ⚠️ **仍阻塞**：账号已登录，但 fine-grained token 缺 `Contents: write`；本地已 commit，等授权后一条命令即可推（§2.1） | 用户 |
| 7 | `docs/dsh-plugin-dev-notes.md` | ✅ **已落盘** | — |
| 8 | `.dsh-src-ref`（355 MB 解包源码） | ✅ 决策：**保留**，并已写进仓库 `.gitignore` | — |
| 9 | **`tools/extract-asar.mjs` 尚未收进仓库** | ✅ **已收进** `tools/extract-asar.mjs`（赶在 `%TEMP%` 被清理之前） | — |


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

## 2. 决策结果（2026-10-05 已定，不再是待办）

| 编号 | 决策 | 结果 |
|---|---|---|
| **D1** | 旧路径留不留 junction 垫片 | **(a) 删除**。`D:\ai\project\dsh-plugin-send-to-chat` 与 `...\dsh-plugin-notifiy-and-sound` 已删除，磁盘上每个插件**只剩一份代码**（新仓库里那份）。代价：两个旧会话只能作为历史阅读。 |
| **D2** | `workspace.json` 里旧的两个 workspace 条目 | **(a) 删除**。会话日志文件原样保留在 `%DSH_HOME%\sessions\` 下，只是不再出现在侧边栏。 |
| **D3** | `notifiy` 目录名是否改为 `notify` | **(a) 改**。现为 `dsh-plugin-notify-and-sound`；**包名 `@local/dsh-notify-sound` 不变**（bundle 清单用的是包名）。 |
| **D4** | 是否写 `docs/dsh-plugin-dev-notes.md` | **写**，已落盘。 |
| **D5** | `web` profile 是否也安装插件 | **不装**。只动 `desktop` profile。 |
| **D6** | `.dsh-src-ref`（355 MB）保留还是删除 | **保留**，并写进仓库 `.gitignore`（它本来就在仓库之外，不会被跟踪）。 |
| **D7** | 是否把 DSH 源码解包脚本收进仓库 | **收**，见 `tools/extract-asar.mjs`。 |

### 2.1 ⚠️ 唯一剩下的阻塞：GitHub 推送权限

* 本地提交已完成（`main` 领先 `origin/main` 一个 commit），remote 已配置 `origin`（HTTPS）与 `ssh`（SSH）两个地址。
* `origin`（HTTPS）推送失败：`403 Resource not accessible by personal access token`
  —— 账号认证成功，但 fine-grained PAT **没有 `Contents: Read and write`**（或没把本仓库勾进它的可访问仓库列表）。
  **重试无用**，必须改 token 权限或换一条授权通道。
* 已验证 **SSH 通道本身是通的**（`ssh.github.com:22` 与 `:443` 均可建立连接），
  只是本机 `~/.ssh/id_rsa` **尚未注册到 GitHub 账号**（`git@github.com: Permission denied (publickey)`）。
* 两条出路，任选其一：
  1. **把 `~/.ssh/id_rsa.pub` 加到账号**（一键预填链接见会话回复）→ 之后
     `git -C D:\ai\project\dsh-plugin push ssh main:main` 即可，无需再动 token。
  2. **给 token 补权限**：fine-grained token 的 *Repository access* 勾上 `bsgxiaobi/dsh-plugin`，
     *Permissions → Repository permissions → Contents = Read and write* → 之后 `git push origin main`。


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
