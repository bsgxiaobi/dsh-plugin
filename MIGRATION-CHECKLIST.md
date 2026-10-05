# DSH 插件仓库迁移 · 执行与检查清单

> **给执行者/验证者的话**：本文档是自包含的。阅读它的会话**没有任何历史上下文**是正常的 ——
> 迁移的全部背景、基线、期望值、验证命令和失败诊断都写在下面。
> 请先读完 §0 和 §1，再动手或开始验证。

---

## 0. 环境事实（本机实测值）

| 项 | 值 |
|---|---|
| `DSH_HOME` | `C:\Users\Bi Shugui\.dsh` |
| `DSH_PROFILE` | `desktop` |
| profile 目录 | `C:\Users\Bi Shugui\.dsh\profiles\desktop` |
| profile 依赖与 bundle 清单 | `<profile>\package.json` |
| profile 补丁层 | `<profile>\cordis.patch.yml` |
| workspace 注册表 | `$DSH_HOME\storages\workspace.json` |
| 会话历史根 | `$DSH_HOME\sessions\<cwd派生桶>\<sessionId>\session.v4.jsonl.zstd` |
| Web GUI | `http://127.0.0.1:19387` |
| git | `C:\Program Files\Git\cmd\git.exe`（2.33.1），身份 `bsgxiaobi <412238561@qq.com>` |
| gh | `C:\Program Files\GitHub CLI\gh.exe`（2.100.0），**迁移时尚未登录** |

### 可用的检查手段

| 手段 | 用途 |
|---|---|
| `pwsh` 工具 | 文件系统、profile 配置、git 的实际状态 |
| `plugin_manager` 工具（`list_plugins` / `list_bundles`） | 插件条目是否 `enabled` + `fiberPhase: active` |
| `cordis_inspect_query`（平台 `client`，provider `Slots`，method `listSubTree`，`{"root":"shell.overlay"}`） | **端到端证明浏览器端插件已加载**：occupants 里应有 `id: "send-to-chat"`, `active: true` |
| `cordis_inspect_query`（平台 `host`，provider `Service`，method `listService`） | 运行时服务契约 |
| `node <插件>\verify-meta.mjs` | DSH 实际会读到的插件标题/说明/图标 |

---

## 1. 迁移前基线（已实测，供对照）

### 1.1 两个插件（真实目录，无 node_modules、无符号链接）

| 目录 | 大小 | 包名 |
|---|---|---|
| `D:\ai\project\dsh-plugin-send-to-chat` | 0.1 MB / 12 文件 | `dsh-plugin-send-to-chat` |
| `D:\ai\project\dsh-plugin-notifiy-and-sound` | 0.1 MB / 8 文件 | `@local/dsh-notify-sound`（注意目录名拼写是 `notifiy`，包名是 `notify`） |

### 1.2 全部旧路径引用点（**迁移必须处理的就是这 7 处**）

| # | 引用点 | 位置 | 迁移前值 |
|---|---|---|---|
| **R1** | profile junction | `<profile>\node_modules\dsh-plugin-send-to-chat` | Junction → `D:\ai\project\dsh-plugin-send-to-chat` |
| **R2** | profile junction | `<profile>\node_modules\@local\dsh-notify-sound` | Junction → `D:\ai\project\dsh-plugin-notifiy-and-sound` |
| **R3** | profile 依赖 | `<profile>\package.json` → `dependencies` | `"dsh-plugin-send-to-chat": "link:D:/ai/project/dsh-plugin-send-to-chat"`、`"@local/dsh-notify-sound": "link:D:/ai/project/dsh-plugin-notifiy-and-sound"` |
| **R4** | profile bundle 清单 | `<profile>\package.json` → `dsh.profile.bundles` | 含 `"dsh-plugin-send-to-chat"`、`"@local/dsh-notify-sound"` |
| **R5** | workspace 注册表 | `$DSH_HOME\storages\workspace.json` | workspace `e0598bfd-7680-4e3b-be5d-e845ef8dd858`.path = `D:\ai\project\dsh-plugin-send-to-chat`；`e03829e1-f9c5-4398-a9e7-fe515834d234`.path = `D:\ai\project\dsh-plugin-notifiy-and-sound` |
| **R6** | 会话头 cwd | 会话日志首帧 | `{"type":"session","version":4,"id":"session-e29dbeb0-…","cwd":"D:\\ai\\project\\dsh-plugin-send-to-chat",…}` |
| **R7** | 会话历史桶 | `$DSH_HOME\sessions\` | `--D-ai-project-dsh-plugin-send-to-chat--`、`--D-ai-project-dsh-plugin-notifiy-and-sound--` |

### 1.3 两条必须记住的平台事实

**事实 A — 会话的 cwd 是不可变的。**
每个会话的第一帧日志里写死了 `cwd`。改 `workspace.json` **不会**改变已有会话的 cwd。
⟹ 已有会话永远要求旧路径存在；想让它们继续可用，旧路径必须保留（目录 junction 垫片）。
⟹ 「合并两个旧会话为一个」在技术上是**不可能的**，只能在新工作区**新开**会话。

**事实 B — 会话历史桶名由 cwd 派生**（`projectKey(cwd)`，见 `@deepseek-ai/dsh-session-persistence-jsonl`）：
盘符冒号与路径分隔符 → `-`，非法字符 → `~XXXX`，最后套 `--…--`。
⟹ **不要手工搬动 `$DSH_HOME\sessions\` 下的桶目录** —— 桶名和会话头里的 cwd 必须一致，搬了会导致会话无法恢复。历史文件原地保留即可。

### 1.4 本次要保住的东西

| 资产 | 位置 | 迁移前 |
|---|---|---|
| 本会话全文 | `$DSH_HOME\sessions\--D-ai-project-dsh-plugin-send-to-chat--\session-e29dbeb0-b7cf-48f6-a4ea-a77234f0505e\session.v4.jsonl.zstd` | **> 1 MB**（撰写本清单时实测 1,443,278 字节；会随对话持续增长，因此判定标准是「> 1 MB 且不小于迁移前」而不是某个精确值）**必须只增不减；迁移不得删除或搬动** |
| 另一会话 | `…\--D-ai-project-dsh-plugin-send-to-chat--\session-11b2f103-88d6-4ea0-bb9c-c1aa3995b0aa\` | 同上（撰写时 329 字节，测试用会话） |
| notify 插件会话 | `…\--D-ai-project-dsh-plugin-notifiy-and-sound--\session-4c991d60-…\` | 同上 |

---

## 2. 目标最终状态

```
D:\ai\project\
├── dsh-plugin\                          ← 新建：git 仓库根 + DSH 新工作区
│   ├── .git\
│   ├── .gitignore
│   ├── README.md
│   ├── docs\
│   │   └── dsh-plugin-dev-notes.md
│   ├── dsh-plugin-send-to-chat\          ← 真实目录
│   └── dsh-plugin-notifiy-and-sound\     ← 真实目录（可选改名 → dsh-plugin-notify-and-sound）
├── dsh-plugin-send-to-chat\              ← 已删除；或保留为 Junction → dsh-plugin\dsh-plugin-send-to-chat
└── dsh-plugin-notifiy-and-sound\         ← 已删除；或保留为 Junction → dsh-plugin\dsh-plugin-notifiy-and-sound
```

| 项 | 目标 |
|---|---|
| R1 / R2 | Junction 指向 `D:\ai\project\dsh-plugin\<插件目录>` |
| R3 | `link:D:/ai/project/dsh-plugin/<插件目录>` |
| R4 | bundle 名不变（仍是包名 `dsh-plugin-send-to-chat` / `@local/dsh-notify-sound`） |
| R5 | 新增一个 workspace：path = `D:\ai\project\dsh-plugin`；旧的两个条目按要求删除或保留 |
| R6 / R7 | **不动**（历史原样保留） |
| git | 已 commit；是否 push 取决于 `gh auth login` |

**判定「完成」的硬标准**：磁盘上每个插件**只有一份代码副本**，且 DSH 加载的就是那一份。

---

## 3. 执行清单

> 标记：`[ ]` 待办 → `[x]` 已完成。**每阶段结束都可以安全停下。**

### 阶段 1 —— 零风险：建仓库（不碰任何 DSH 配置）

- [ ] **1.1** 新建 `D:\ai\project\dsh-plugin`
- [ ] **1.2** 复制两个插件目录进去（**建议用复制而非移动**：两个插件合计仅 0.2 MB，复制可让旧状态与当前会话保持完好，回滚只需删新目录）
      ```powershell
      New-Item -ItemType Directory -Force -Path 'D:\ai\project\dsh-plugin' | Out-Null
      Copy-Item 'D:\ai\project\dsh-plugin-send-to-chat'    'D:\ai\project\dsh-plugin\' -Recurse -Force
      Copy-Item 'D:\ai\project\dsh-plugin-notifiy-and-sound' 'D:\ai\project\dsh-plugin\' -Recurse -Force
      ```
- [ ] **1.3** 删除新位置里的构建产物 `dsh-plugin-send-to-chat\dsh-plugin-send-to-chat-0.1.0.tgz`（决定：tgz 不纳入版本控制）
- [ ] **1.4** 写根 `.gitignore`（内容见 §3.5）
- [ ] **1.5** 写根 `README.md`（介绍仓库里的两个插件）
- [ ] **1.6** 写 `docs\dsh-plugin-dev-notes.md`（见 §7）
- [ ] **1.7** `git init` + 首次提交
      ```powershell
      cd 'D:\ai\project\dsh-plugin'
      git init
      git add -A
      git status --short          # 期望：无 node_modules、无 *.tgz
      git commit -m "chore: import send-to-chat and notify-sound plugins"
      ```
- [ ] **1.8** 确认**没有触碰**：`<profile>\package.json`、`<profile>\cordis.patch.yml`、`$DSH_HOME\storages\workspace.json`、`$DSH_HOME\sessions\`

> 阶段 1 结束状态：新仓库就绪，但 DSH 仍从旧路径加载插件 —— **这是预期的中间态**，见 §5 坑 G1。

### 3.5 根 `.gitignore` 建议内容

```gitignore
node_modules/
*.tgz
*.log
.DS_Store
Thumbs.db
```

### 阶段 2 —— 在 DSH 里开新工作区（人工 · GUI）

- [ ] **2.1** 侧边栏「添加工作区」→ 选择 `D:\ai\project\dsh-plugin`
- [ ] **2.2** 在该工作区里开一个新会话（DSH 原生支持「一个工作区多个会话」，不必只开一个）
- [ ] **2.3** 在新会话里确认文件树能看到 `dsh-plugin-send-to-chat\` 和 `dsh-plugin-notifiy-and-sound\` 两个子目录

> ⚠️ 此刻**功能仍由旧路径的副本提供**。不要在这时修改新路径的代码并期待生效 —— 见 G1。

### 阶段 3 —— 重指向 profile（⚠️ 会触发一次 profile 重载）

> 这一步会打扰正在运行的任务。**建议与「计划中的 DSH 重启」合并进行。**

- [ ] **3.1** 备份两个文件
      ```powershell
      $p = "$env:DSH_HOME\profiles\desktop"
      $t = Get-Date -Format 'yyyyMMdd-HHmmss'
      Copy-Item "$p\package.json"     "$p\package.json.bak-$t"
      Copy-Item "$env:DSH_HOME\storages\workspace.json" "$env:DSH_HOME\storages\workspace.json.bak-$t"
      ```
- [ ] **3.2** 改 `<profile>\package.json` 的两条依赖为
      `"dsh-plugin-send-to-chat": "link:D:/ai/project/dsh-plugin/dsh-plugin-send-to-chat"`
      `"@local/dsh-notify-sound":   "link:D:/ai/project/dsh-plugin/dsh-plugin-notifiy-and-sound"`
      （`dsh.profile.bundles` 里的**包名**不变，不要改）
- [ ] **3.3** 重建 junction
      ```powershell
      cd "$env:DSH_HOME\profiles\desktop"
      pnpm install
      ```
- [ ] **3.4** 验证 R1/R2 已指向新路径（见 §4 V2）

### 阶段 4 —— 清理（**必须在 DSH 停止时做**）

> 原因：`workspace.json` 被 DSH 载入内存，运行中修改会被覆盖。

- [ ] **4.1** 备份 `workspace.json`
- [ ] **4.2** 删除旧的两个插件目录（或改为 Junction 垫片 —— 见 §6 决策点 D1）
      ```powershell
      Remove-Item 'D:\ai\project\dsh-plugin-send-to-chat'    -Recurse -Force
      Remove-Item 'D:\ai\project\dsh-plugin-notifiy-and-sound' -Recurse -Force
      ```
- [ ] **4.3** 处理 `workspace.json` 里旧的两个 workspace 条目（见 §6 决策点 D2）
- [ ] **4.4** 启动 DSH，跑 §4 全部验证项

### 阶段 5 —— GitHub

- [ ] **5.1** `gh auth login`（人工）
- [ ] **5.2** 建仓并推送
      ```powershell
      cd 'D:\ai\project\dsh-plugin'
      gh repo create dsh-plugin --private --source=. --remote=origin --push
      ```
      （仓库名/可见性可改；若已有远程仓库，用 `git remote add origin <url>` + `git push -u origin HEAD`）
- [ ] **5.3** `git remote -v` 与 GitHub 页面确认一致

---

## 4. 验证清单

> 每条都给出「命令 → 期望」。**失败时去 §5 查对应坑。**

### V1 — 目录结构与副本唯一性（最关键）

```powershell
foreach ($p in @(
  'D:\ai\project\dsh-plugin',
  'D:\ai\project\dsh-plugin\dsh-plugin-send-to-chat',
  'D:\ai\project\dsh-plugin\dsh-plugin-notifiy-and-sound',
  'D:\ai\project\dsh-plugin-send-to-chat',
  'D:\ai\project\dsh-plugin-notifiy-and-sound'
)) {
  $i = Get-Item $p -Force -ErrorAction SilentlyContinue
  if ($i) {
    $rp = [bool]($i.Attributes -band [IO.FileAttributes]::ReparsePoint)
    "{0,-58} 存在   reparse={1}   target={2}" -f $p, $rp, ($(if($rp){$i.Target}else{''}))
  } else { "{0,-58} 不存在" -f $p }
}
```

**期望**：`dsh-plugin` 与两个子目录存在且 `reparse=False`；两个旧路径**要么不存在，要么 `reparse=True` 且 target 指向 `dsh-plugin\...`**。
**失败含义**：旧路径仍是 `reparse=False` 的真实目录 ⟹ 副本不唯一 ⟹ 有分裂脑风险（G1）。

### V2 — profile 链接已指向新路径

```powershell
$nd = "$env:DSH_HOME\profiles\desktop\node_modules"
foreach ($n in @('dsh-plugin-send-to-chat','@local\dsh-notify-sound')) {
  $i = Get-Item "$nd\$n" -Force -ErrorAction SilentlyContinue
  "$n  ->  LinkType=$($i.LinkType)  Target=$($i.Target)"
}
```

**期望**：两个都是 `Junction`，`Target` 指向 `D:\ai\project\dsh-plugin\<插件目录>`。

### V3 — profile 依赖与 bundle 清单

```powershell
Get-Content "$env:DSH_HOME\profiles\desktop\package.json" -Raw
```

**期望**：`dependencies` 里两条 `link:` 都指向 `dsh-plugin/` 下的新路径；`dsh.profile.bundles` 仍含 `"dsh-plugin-send-to-chat"` 与 `"@local/dsh-notify-sound"`（包名，不含路径）。

### V4 — 宿主侧插件条目已激活

用 `plugin_manager` 工具，`action: list_plugins`（可分页，`limit: 100`，`offset` 递增）：

**期望**：存在
```json
{"entryId":"include:send-to-chat","moduleName":"dsh-plugin-send-to-chat","enabled":true,"fiberPhase":"active"}
```
以及 notify 插件对应的 `enabled: true` / `fiberPhase: "active"` 条目。

### V5 — 浏览器端插件已加载（端到端）

`cordis_inspect_query`，`platform: client`，`provider: Slots`，`method: listSubTree`，`input: {"root":"shell.overlay"}`

**期望**：`selected.occupants` 含
```json
{"registrant":"…","id":"send-to-chat","order":1000,"active":true}
```
**失败含义**：宿主条目活着但这里看不到 ⟹ 浏览器端 bundle 没加载 ⟹ 检查刷新页面 / `clientModules` 报错。

### V6 — workspace 注册表

```powershell
Get-Content "$env:DSH_HOME\storages\workspace.json" -Raw
```

**期望**：存在一个 workspace，`path` = `D:\ai\project\dsh-plugin`；旧的两个条目按决策 D2 处理（删除或保留）。

### V7 — 会话历史未被破坏（**进度没丢**）

```powershell
Get-ChildItem "$env:DSH_HOME\sessions" -Directory | Select-Object -ExpandProperty Name

Get-ChildItem "$env:DSH_HOME\sessions\--D-ai-project-dsh-plugin-send-to-chat--" -Directory |
  ForEach-Object {
    $f = Get-ChildItem $_.FullName -File | Select-Object -First 1
    "{0}   {1} bytes" -f $_.Name, $f.Length
  }
```

**期望**：旧的桶目录 `--D-ai-project-dsh-plugin-send-to-chat--`、`--D-ai-project-dsh-plugin-notifiy-and-sound--` **仍然存在**，且桶内仍列出 `session-e29dbeb0-…`（本会话，**> 1 MB**）与 `session-11b2f103-…`。
**失败含义**：桶目录或文件消失/变小 ⟹ 历史被破坏（严重）。
> 注意：不要期待某个精确字节数 —— 只要本会话那份**明显超过 1 MB 且不比你迁移前看到的小**即正常。

### V8 — 插件元数据（图标 + 中文标题/说明）

```powershell
node 'D:\ai\project\dsh-plugin\dsh-plugin-send-to-chat\verify-meta.mjs'
```

**期望**：`languages found: en, zh`；`zh` 下 title=`发送到对话框`、description=中文；`--- icon ---` 显示 `icon.svg`、`image/svg+xml`、约 544 bytes。

GUI 侧：**设置 → 插件** 里该插件应显示**图标 + 中文标题 + 中文说明**。
**若仍是英文/无图标** ⟹ 见 G2（改 `exports` 必须重启 DSH）。

### V9 — git 仓库

```powershell
$r = 'D:\ai\project\dsh-plugin'
git -C $r status --short                                     # 期望：空（干净）
git -C $r log --oneline -3
git -C $r ls-files | Select-String 'tgz|node_modules|\.bak'  # 期望：无输出
git -C $r remote -v                                          # 阶段 5 后应有 origin
```

### V10 — 功能回归（人工，GUI）

- [ ] 侧边栏「工作区文件」里右键一个文件 → 出现「发送到对话框」→ 点击后输入框出现 `@` 引用 chip
- [ ] 右键一个目录 → `@dir/`
- [ ] 在右侧文本/代码预览里拖选若干行后右键 → 「发送到对话框（第 n-m 行）」→ 输入框出现 `@路径#n-m`
- [ ] 目标输入框是**当前可见/聚焦**的那个

---

## 5. 已知坑与诊断

### G1 — 分裂脑（**最危险，且最隐蔽**）

**症状**：改了新路径的代码，刷新页面却没变化；或插件行为像旧版本。
**成因**：旧目录还在，且 profile 的 junction 仍指向旧路径。DSH 从旧副本加载，你在新副本上编辑。
**诊断**：§4 V1（副本唯一性）+ V2（Target 指向）。
**解决**：完成阶段 3 或阶段 4；确认最终只剩一份代码。

### G2 — 改 `package.json` 的 `exports` 必须重启 DSH

**症状**：新增/修改 `exports` 子路径（例如加 `"./locale/*.json"`）后，插件元数据不生效，**刷新页面无效**。
**成因**：DSH 通过 Node **内部 ESM 解析器**读插件元数据（`readPluginMeta` → `optionalResourcePath` → `ModuleLoader.fromInternal().resolveSync`），该解析器**缓存 package.json 的 `exports` 映射且不随文件变化失效**。实测同进程内新增 exports 后仍返回 `ERR_PACKAGE_PATH_NOT_EXPORTED`，新进程才正常。
**对照表**：

| 改动 | 生效方式 |
|---|---|
| `lib/client.js`（浏览器端逻辑） | 刷新页面 |
| `package.json` 的 `icon` | 重进插件页（manifest 内容是每次现读的） |
| **`package.json` 的 `exports`** | **必须重启 DSH** |
| `locale/*.json` 的**文案内容**（不动 `exports`） | 重启后即可热改 |

### G3 — junction 链的读数陷阱

旧路径是 junction、profile 的 junction 又指向旧路径时，`(Get-Item <profile链接>).Target` 显示的是**旧路径**，不代表最终落点。要判最终落点需逐层展开，或直接确认「只剩一份真实副本」（V1）。

### G4 — 会话 cwd 不可变（§1.3 事实 A）

**症状**：旧会话打开后文件树空白 / 相对路径工具报错 / `@` 引用失败。
**成因**：该会话的 cwd 指向已被删除的旧路径。
**解决**：要么保留旧路径的 junction 垫片（决策 D1），要么接受该会话只能作为历史记录阅读，在新工作区开新会话继续。

### G5 — `workspace.json` 运行中被覆盖

**症状**：改了 `workspace.json`，DSH 一跑就变回去。
**成因**：DSH 载入内存后写回。
**解决**：**必须在 DSH 停止时**修改（阶段 4）。

### G6 — 包名与目录名不一致

`@local/dsh-notify-sound`（包名，拼写正确）住在 `dsh-plugin-notifiy-and-sound`（目录名，拼写为 `notifiy`）。
若决定改目录名：需同步更新 **R1/R2 的 junction**、**R3 的 `link:`**、**R5 的 workspace path**；**R4 的 bundle 名（包名）不变**。

---

## 6. 需要人工决策的岔路

| 编号 | 决策 | 选项 |
|---|---|---|
| **D1** | 旧路径留不留 junction 垫片 | **(a) 删掉**：仓库最干净；但 R6 涉及的旧会话从此只能当历史阅读。<br>**(b) 保留**：旧会话继续可用；代价是路径多一层间接、磁盘上有两个 junction。 |
| **D2** | `workspace.json` 里旧的两个 workspace 条目 | **(a) 删除**（历史日志文件不动，只是不再出现在侧边栏）<br>**(b) 保留**（若旧路径已删，侧边栏会出现指向失效路径的工作区） |
| **D3** | `notifiy` 目录名是否改为 `notify` | **(a) 改**：趁现在（本来就要改 R1/R2/R3/R5）最便宜<br>**(b) 不改**：避免额外变动 |
| **D4** | 是否写 `docs/dsh-plugin-dev-notes.md` | 建议写 —— 见 §7 |

---

## 7. 附：DSH 插件平台要点（供后续开发，也是 `docs/dsh-plugin-dev-notes.md` 的素材）

> 这些是本次迁移前对 DSH 内部实现的实测结论，**没有官方公开文档**，全部来自阅读 `app.asar` 解包源码 + 运行时 Inspect 验证。

### 7.1 插件包结构

- 一个包可以**同时**是 bundle 和 plugin：
  - `dsh.bundle.patch: "./cordis.patch.yml"` → 可被插件管理器安装/启停
  - `dsh.client: { platform: "web", inject: [...] }` → 浏览器端 bundle
  - `main` → 宿主端（可为空 `apply`）
- bundle 的 `cordis.patch.yml` 可以插入**自己**（`name: '<包名>'`），也可插入其它包。
- `insert` 行的 `name` 支持：**包名**、**绝对路径**、`file://` URL。用绝对路径可完全免去 `pnpm install`。
- 浏览器端 bundle 必须是 `window.__ModuleLoader__.load({ id, factory })` 格式；`factory(require)` 内 `exports.apply` / `exports.inject`。

### 7.2 浏览器端可用基线模块

`react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-store` 等属**基线**，可直接 `require`，不必写进 `dsh.client.external`。非基线模块必须写进 `external`。

### 7.3 Slot 体系的关键约束

- 四种 kind：`single` / `list` / `keyed` / `chain`。
- **「声明即独占」**：keyed slot 的每个 key 只允许一个占用者 → 插件**无法包装**别人的 slot 内容。
- 已确认可用的注册点（本插件用到/查证过）：
  - `shell.overlay`（root/list）—— 框架级浮层，适合自绘菜单
  - `sidebar.right.tab.files.actions`（session/list）—— 文件页工具栏
  - `sidebar.right.tab.document.actions`（session/list）—— 预览页工具栏
  - `conversation.input.overlay` / `conversation.composer.dock`（session/list）
- `ctx.slots.inject(key, cb)` 用于等待 slot 被声明后注册。

### 7.4 Composer 插入（无公开文档，但可用的通道）

- `ctx.get('conversation').input.shell(sessionId)` → 该会话的输入 shell。
- `shell.actions.captureInsertion()` → `{ start, end, draftRev }`。
- `shell.actions.insertText(text, span)` → 插入纯文本（有 undo、有 rev CAS）。
- `shell.insertReference({ source:'reference', ref:'@path', label, appearance:'file'|'folder', clipboardText }, span)` → 插入**真正的引用 chip**（与 `@` 菜单选文件等价）。
- `shell.notify(level, text)` → 用户可见提示。

### 7.5 可依赖的宿主 DOM 锚点（只读，勿修改宿主 DOM）

| 锚点 | 含义 |
|---|---|
| `li[data-files-entry][data-files-path]` | 工作区文件树的一行（`entry` = file/directory/other；`path` = 绝对路径）。注意表头的 `PathLabel` 也带 `data-files-path`，须靠 `li` + `data-files-entry` 排除 |
| `[data-files-root]` | 文件树的根（= 会话 cwd） |
| `[data-textpreview-state="text"]` | 已加载的文本/代码预览 |
| `[data-textpreview-url]` | 资源地址 `dsh-resource://file/session/<sessionId>/<相对路径>` |
| `[data-textpreview-path]` | 预览文件显示的路径 |
| `[data-textpreview-plain] [data-textpreview-line="n"]` | 纯文本渲染器的第 n 行 |
| `[data-code-preview] .line` | 代码渲染器的一行（序号 = 1-based 行号） |
| `[data-composer-input]` | Lexical 编辑器根（`isContentEditable` 为真才可插入） |
| `[data-conversation-session]` | 会话容器，属性值 = sessionId |

### 7.6 其它已踩过的坑

- **文件树本来就没有右键菜单**（`dsh-client-ui-sidebar-files` README 把 context menu 列在 Known Limitations），也没有行级 Slot → 只能靠上面的 DOM 锚点自己实现菜单。
- `@file` 语法**不支持行范围**：`dsh-file-reference` 只定义 `@path` 与 `@"path with spaces"`（结尾 `/` 表示目录）。所以 `@path#n-m` 只能是纯文本，做成 chip 点击会去找名为 `path#n-m` 的文件而失败。
- 纯文本 `@file.md` **不会**被渲染成 chip（扫描只认 `@dir/` 与 lexicon 内的名字），文件引用要 chip 必须走 `insertReference`。
- `plugin_manager` 工具的 `list_bundles` **不含** UI 展示元数据（`meta`）；要看本地化标题/说明得靠 GUI 或 `verify-meta.mjs`。

---

## 8. 执行记录（2026-10-05 实际结果）

> 这一节是**事后补记**：记录实际做了什么、与上面清单的偏差、以及仍未完成的部分。
> 判定「完成」的硬标准（§2）已满足：**磁盘上每个插件只有一份代码副本，且 DSH 加载的就是那一份。**

### 8.1 逐阶段结果

| 阶段 | 状态 | 实际做法 / 偏差 |
|---|---|---|
| **1.1 / 1.2** 建目录 + 复制 | ✅ | 新仓库 `D:\ai\project\dsh-plugin` 已建，两个插件目录已复制（在上一轮会话完成）。删除前用 **SHA256 逐文件比对** 过：除两处有意修改的 `README.md` 外，新旧副本**字节完全一致** |
| **1.3** 删 tgz | ✅ | 删掉 `dsh-plugin-send-to-chat\dsh-plugin-send-to-chat-0.1.0.tgz`，并由 `.gitignore` 的 `*.tgz` 兜底 |
| **1.4** 根 `.gitignore` | ✅ | 按 §3.5，另加 `.dsh-src-ref/` 与 `*.bak-*` |
| **1.5** 根 `README.md` | ✅ | 新增：两个插件简介、目录结构、profile 注册方式、两条最容易踩的坑、许可证说明 |
| **1.6** `docs/dsh-plugin-dev-notes.md` | ✅ | 按 §7 扩写，另补「宿主端入口文件也必须重启」「各插件占用的 slot 登记」「升级后自检顺序」 |
| **1.7** `git init` + 首次提交 | ✅ | 见 §8.3 的**偏差 1** |
| **2.1–2.3** 新工作区 | ✅ | 已在上一轮完成（workspace `935b99e0-…`，path = `D:\ai\project\dsh-plugin`） |
| **3.1** 备份 | ✅ | 备份 `package.json`、`pnpm-lock.yaml`、`workspace.json`，后缀 `bak-20261005-200628` |
| **3.2** 改 profile 依赖 | ✅ | 两条 `link:` 均指向 `dsh-plugin/<插件目录>`；**`dsh.profile.bundles` 未动**（仍是包名） |
| **3.3** `pnpm install` | ✅ | 在 `%DSH_HOME%\profiles\desktop` 执行，`pnpm` 报告 *Already up to date*，但 junction 与 lock 已按新路径重建（§3.4 验证通过） |
| **3.4 / V2 / V3** 验证 | ✅ | 两个链接均为 `Junction`，Target 指向新路径；lock 里旧路径已消失 |
| **4.1** 备份 `workspace.json` | ✅ | `workspace.json.bak-20261005-200628` |
| **4.2** 删除旧目录 | ✅ | 决策 **D1(a)**：两个旧目录已删除（删除前已做 SHA256 比对） |
| **4.3** 处理旧 workspace 条目 | ✅ | 决策 **D2(a)**：从 `global.workspaceIds` 与 `tables.workspaces` 中移除 `e0598bfd-…`、`e03829e1-…`；JSON 语法已校验 |
| **4.4** 启动 DSH 跑验证 | ⏳ | **待用户重启 DSH**（见 §8.4） |
| **5.1 / 5.2 / 5.3** GitHub | ⚠️ | **未完成**：token 缺 `Contents: write`（403）；SSH 通道可达但本机公钥尚未注册。详见 §8.5 |
| **V1** 副本唯一性 | ✅ | `dsh-plugin` 与两个子目录存在且 `reparse=False`；两个旧路径**已不存在** |
| **V7** 会话历史 | ✅ | 6 个桶目录全部原样保留；本对话所在桶 `--D-ai-project-dsh-plugin--` 完好，旧桶 `--D-ai-project-dsh-plugin-send-to-chat--` 内 `session-e29dbeb0-…` 实测 **1,519,939 字节（> 1 MB，且比迁移前更大）** |
| **V8** 插件元数据 | ✅ | `node verify-meta.mjs` 输出 `languages found: en, zh`，`zh` 下 title=`发送到对话框`、icon=544 bytes SVG |
| **V9** git 仓库 | ⚠️ | 本地 `status` 干净、无 `tgz/node_modules/.bak` 被跟踪；**远程推送未完成**（§8.5） |
| **V10** 功能回归 | ⏳ | **人工待办**，见 `FOLLOW-UP-WORK.md` §1 |

### 8.2 与清单的偏差（需要知道）

1. **`notifiy` → `notify` 改名（决策 D3=a）**：新仓库里的目录是 `dsh-plugin-notify-and-sound`。
   清单里凡是写 `dsh-plugin-notifiy-and-sound` 的地方，若指**新仓库内的目录**，实际名字是 `notify`；
   若指**已删除的旧路径**或**会话历史桶名**，则保持 `notifiy` 不变（桶名由 cwd 派生，不能改）。
   **包名 `@local/dsh-notify-sound` 始终不变**，bundle 清单不受影响。
2. **`.gitattributes` 是清单里没有的一步**：新增 `* text=auto eol=lf`，避免 Windows 上出现纯换行符的噪音提交。
3. **`tools/extract-asar.mjs` 被收进了仓库**（来自 `FOLLOW-UP-WORK.md` 的 D7）——原脚本只存在于 `%TEMP%`，随时会被清理。
4. **没有做 `web` profile 的安装**（决策 D5=不装）。
5. **没有手工搬动任何会话桶目录**（遵守 §1.3 事实 B）。

### 8.3 偏差 1 的细节：git 历史基线

远程 `main` 已有一个 `67a7444 Initial commit`（只含 `LICENSE`，Apache-2.0，建仓时由 GitHub 生成）。
为了不产生无关历史，本次**没有**用 `git init` 后强推，而是：

```powershell
cd 'D:\ai\project\dsh-plugin'
git init -b main
git remote add origin https://github.com/bsgxiaobi/dsh-plugin.git
git fetch origin main
git reset --hard origin/main     # 先把 LICENSE 落到工作区，让历史线性
git add -A
git commit -m "chore: import send-to-chat and notify-sound plugins"
```

结果历史为 `67a7444 Initial commit` → `26bf4ba chore: import …`，可快进推送。

### 8.4 重启 DSH 后要确认的（只剩这一步是自动可验的）

1. **设置 → 插件**：`发送到对话框` 应显示**图标 + 中文标题 + 中文说明**（§4 V8）。
   本机 CLI 已跑通 `verify-meta.mjs`，但 DSH 进程内的 `exports` 缓存**必须重启才刷新**（§5 坑 G2）。
2. **`plugin_manager` `list_plugins`**：两个插件条目应仍为 `enabled: true` + `fiberPhase: "active"`（§4 V4）。
3. **`cordis_inspect_query`（client / Slots / listSubTree / `{"root":"shell.overlay"}`）**：`occupants` 里应有 `id: "send-to-chat"`, `active: true`（§4 V5）。
4. **侧边栏工作区列表**：应只剩 `draw`、`dsh-plugin`、`temp`；若两个旧工作区又冒出来，说明 DSH 在退出时把内存里的旧 `workspace.json` 写回了（§5 坑 G5），在 GUI 里删掉即可，或重新应用 §8.1 的 4.3 改动。
5. **人工跑 `FOLLOW-UP-WORK.md` §1 的四项交互**。

### 8.5 GitHub 推送的阻塞与出路

* `origin`（HTTPS）推送返回 `403 Resource not accessible by personal access token`：
  账号认证成功（`gh auth status` 显示 `bsgxiaobi`），但该 fine-grained PAT **没有 `Contents: Read and write`**
  （或没把 `bsgxiaobi/dsh-plugin` 勾进它的可访问仓库列表）。**重试无效**。
* 同时确认 **SSH 通道是通的**（`ssh.github.com:22`、`:443` 都能建连），
  只是本机 `~/.ssh/id_rsa` / `id_ed25519` **尚未注册到该账号** → `git@github.com: Permission denied (publickey)`。
* 仓库已配两个 remote：`origin` = HTTPS，`ssh` = `git@github.com:bsgxiaobi/dsh-plugin.git`。
* 两条出路（任选其一）：
  1. 在 GitHub 账号里加入本机公钥 `~/.ssh/id_rsa.pub`，然后
     `git -C D:\ai\project\dsh-plugin push ssh main:main`；
  2. 给 token 补权限（*Repository access* 勾本仓库；*Contents = Read and write*），然后 `git push origin main`。
* 本地提交不会丢：`git status` 干净，`main` 领先 `origin/main` 一个 commit。

