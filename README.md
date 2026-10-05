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
