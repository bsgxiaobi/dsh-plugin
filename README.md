# dsh-plugin

DeepSeek Harness（DSH）插件集合 —— 两个 Web GUI 插件，同一个 DSH 工作区。

DSH 的插件系统**没有公开文档**，本仓库里的两个插件都是照着 `app.asar` 解包出来的内部实现写的。
踩过的坑、验证过的内部接口、DOM 锚点等全部结论都记在 [docs/dsh-plugin-dev-notes.md](docs/dsh-plugin-dev-notes.md)，改代码前先看它。

## 仓库里的两个插件

| 目录 | 包名 | 作用 |
|---|---|---|
| [`dsh-plugin-send-to-chat/`](dsh-plugin-send-to-chat/) | `dsh-plugin-send-to-chat` | 在侧边栏**工作区文件**树里右键文件/目录，或在右侧文本、代码预览里选中若干行后右键，把 `@引用` 直接插进对话框。文件与目录插入的是**真正的引用 chip**，行范围插入 `@path#n-m` 纯文本。 |
| [`dsh-plugin-notify-and-sound/`](dsh-plugin-notify-and-sound/) | `@local/dsh-notify-sound` | 会话完成、需要授权、需要你选择时，右上角弹卡片 + Windows 系统通知 + 提示音。通知与提示音各自可开关，音源可选内置 3 种或自定义文件。 |

> 目录名 `dsh-plugin-notify-and-sound` 是 2026-10 迁移时从拼错的 `dsh-plugin-notifiy-and-sound` 改过来的；
> **包名一直是拼写正确的复数形式**（`@local/dsh-notify-sound`），bundle 清单里用的是**包名**，不受目录名影响。

## 目录结构

```
dsh-plugin\
├── dsh-plugin-send-to-chat\       宿主端 lib/index.js（空 apply）+ 浏览器端 lib/client.js
├── dsh-plugin-notify-and-sound\   宿主端 host.js + 浏览器端 client.js
├── docs\dsh-plugin-dev-notes.md   DSH 插件平台内部机制笔记（本仓库最有价值的文件）
├── tools\extract-asar.mjs         把 DSH 的 app.asar 解包成可读源码树（纯 Node，无依赖）
├── MIGRATION-CHECKLIST.md         从两个独立目录迁到单一仓库的执行与验证清单
└── FOLLOW-UP-WORK.md              迁移之后还剩什么没做 / 已知限制
```

## 安装到 DSH

两个插件都已在 `desktop` profile 里注册为 bundle（`%DSH_HOME%\profiles\desktop\package.json`）：

```jsonc
{
  "dependencies": {
    "@local/dsh-notify-sound":   "link:D:/ai/project/dsh-plugin/dsh-plugin-notify-and-sound",
    "dsh-plugin-send-to-chat":   "link:D:/ai/project/dsh-plugin/dsh-plugin-send-to-chat"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-plugin-send-to-chat",
        "@local/dsh-notify-sound"
      ]
    }
  }
}
```

改完 `dependencies` 后在 profile 目录执行一次 `pnpm install` 重建 junction；
`dsh.profile.bundles` 里写的是**包名**，不要写成路径。

装在别的机器上也可以完全不碰 profile：`cordis.patch.yml` 里 `insert` 行的 `name` 接受**绝对路径**，
例如 `name: 'D:/plugins/dsh-plugin-send-to-chat'`，这样连 `pnpm install` 都不需要。
`dsh-plugin-send-to-chat` 还带了一个 `install.mjs`（`node install.mjs [profile]`）自动完成这一步。

## 只装其中一个插件

两个插件**完全独立**：`send-to-chat` 的 peer 只有 cordis，notify 的 peer 只有可选的 schemastery，
互不依赖、不共享代码、没有共同的前提包。装哪个就只处理哪个目录：

- **别**把另一个包名写进 `dsh.profile.bundles`，也**别**给它加 `link:` 依赖；
- 用插件管理器按**路径**安装时，装哪个目录就只登记哪个 —— 本来就是「只装一个」；
- `git clone` 整个仓库**不会**安装任何东西，仓库在场 ≠ 插件已装。

| 想装 | 安装单元（目录） | 包名（写进 `bundles` / 按名字安装时用） |
|---|---|---|
| 发送到对话框 | `dsh-plugin-send-to-chat\` | `dsh-plugin-send-to-chat` |
| 通知与提示音 | `dsh-plugin-notify-and-sound\` | `@local/dsh-notify-sound`（**与目录名不同**，别混用） |

## 装到另一台电脑

插件**零运行时依赖**（`react`、`@deepseek-ai/dsh-client-ui-primitives` 这些基线模块由 DSH 客户端自己提供），
所以**不用联网、不用 `pnpm install`、不用 npm registry**：把要装的那**一个目录**整个拷过去就行
（也可以 `git clone` 后只取需要的那个目录）。

### 路线 1 —— 插件管理器按路径安装（推荐，两个插件通用）

在目标机器的 DSH 里：**设置 → 插件 → 安装**，选那个目录的**绝对路径**。
用 Agent 驱动的话就是 `plugin_manager` 的 `install_bundle`，`target` = 目录绝对路径。

它会写好 `link:` 依赖并登记到 `dsh.profile.bundles`，之后能在插件页随时启停 / 卸载。**本机就是这么装的。**

### 路线 2 —— 纯命令行（只有 send-to-chat 自带脚本）

```powershell
cd <拷过去的>\dsh-plugin-send-to-chat
node install.mjs              # 自动取 $DSH_PROFILE，否则用 desktop
node install.mjs web          # 指定 profile
node install.mjs --dry-run    # 只打印要写入的内容，不动文件
```

它往 `<DSH_HOME>\profiles\<profile>\cordis.patch.yml` 追加一行 `insert`，`name` 用**绝对路径**
（loader 接受绝对路径，故不需要 pnpm、也不要求包名可解析）；写入前自动备份，且幂等
（已有 `id: send-to-chat` 就跳过）。

`notify` 没有安装脚本。要纯命令行装它，就手写同样的一行（id 用 `notify-sound`）：

```yaml
- insert:
    - id: notify-sound
      name: 'D:/plugins/dsh-plugin-notify-and-sound'
```

> 这条等价写法**未在本机实测**（本机的 notify 是走路线 1 装的）。拿不准就用路线 1。

### ⚠️ 装完 / 挪动目录后必须重启 DSH

**只要插件的目录被移动、重命名过，就一定要重启**：Node 的模块解析器在进程内缓存 junction 的
realpath，缓存里的旧路径一旦失效，插件页会退化成「包名 + 通用拼图图标」，宿主端入口也不会重新解析。
详见 [docs/dsh-plugin-dev-notes.md](docs/dsh-plugin-dev-notes.md) §3.1（坑 G2b）。

### ⚠️ 目标机器的 DSH 版本要对得上

| 项 | 要求 |
|---|---|
| cordis | 两个插件都声明了 peer 依赖；`send-to-chat` 是 `@deepseek-ai/cordis: ~4.0.4`。目标机器 DSH 若内置 cordis 4.1+，**插件管理器会直接拒绝安装**（可用版本豁免强装，但有崩溃风险） |
| DSH 客户端版本 | 插件依赖宿主发布的 `data-*` DOM 锚点与 `ctx.get('conversation').input` 接口，针对 **0.2.0-rc.2** 开发。目标机器版本差异较大时要重新核对 `lib/client.js` 顶部的选择器常量 |
| Node | 仅路线 2 的 `install.mjs` / `verify-meta.mjs` 需要，Node 18+（只用内置模块） |

## 开发须知（最容易踩的两条）

1. **改 `package.json` 的 `exports` 必须重启 DSH。** DSH 用 Node 内部 ESM 解析器读插件元数据，
   它缓存 `exports` 映射且不随文件失效。只改 `lib/client.js` 刷新页面即可，改 `exports` 重启才行。
2. **插件依赖的全是 DSH 内部实现**（DOM 锚点、composer 插入接口、slot 注册点），
   DSH 升级后最可能坏的就是这些。升级后的自检顺序见 [docs/dsh-plugin-dev-notes.md](docs/dsh-plugin-dev-notes.md)。

## tools/extract-asar.mjs

把 DSH 的 `app.asar` 解包成可读源码树，用于查阅内部实现：

```powershell
node tools/extract-asar.mjs `
  "C:\Users\<你>\AppData\Local\Programs\DeepSeek Harness\resources\app.asar" `
  "D:\ai\project\.dsh-src-ref"
```

纯 Node、零依赖；解包结果不进版本控制。

## 许可证

仓库根部的 `LICENSE` 是 Apache-2.0（GitHub 建仓时选择）。
`dsh-plugin-send-to-chat/package.json` 里写的是 `MIT`，`dsh-plugin-notify-and-sound` 未声明 ——
如需统一，改 package.json 的 `license` 字段或替换根 LICENSE。
