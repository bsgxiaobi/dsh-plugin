/**
 * Host half of `@local/dsh-notify-sound`.
 *
 * The Host owns the settings (`Config`) and the three moments that deserve the
 * user's attention — a Turn that finished, a `ask_user_question` request, and a
 * tool-call approval request — and pushes each one to the browser half as one
 * Server-Sent-Events frame. The browser half owns everything the user sees and
 * hears: the top-right notification card, the sound, and the system
 * notification.
 *
 * The push channel is an ordinary plugin Web route (`ctx.webServer.register`),
 * the same transport `@deepseek-ai/dsh-client-hmr` uses for `/plugins/events`.
 * It also serves the configured custom sound file, so the browser can play a
 * local file the page's origin could never read on its own.
 *
 * @module @local/dsh-notify-sound
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/** Cordis plugin name. */
export const name = 'notify-sound'

/** Required service: the Web route registry that carries the push channel. */
export const inject = ['webServer']

/** SSE endpoint the browser half connects to (document-relative on the client). */
const EVENTS_PATH = '/plugin-notify-sound/events'

/** Endpoint that serves the configured custom sound file. */
const SOUND_PATH = '/plugin-notify-sound/sound'

/** Endpoint the browser half reports failures to. */
const REPORTS_PATH = '/plugin-notify-sound/report'

/**
 * Endpoint the configuration page reads and writes.
 *
 * These settings deliberately live in this plugin's own file rather than in a
 * platform settings namespace: a deployment only serves those namespaces when a
 * settings provider is mounted, and this one mounts none, so a namespace-bound
 * page could never resolve. The composition row's `config` stays the default
 * layer and this file holds only what the user changed.
 */
const SETTINGS_PATH = '/plugin-notify-sound/settings'

/**
 * Endpoint that opens the host's own file chooser for the sound path.
 *
 * There is no Electron dialog and no file-picking API anywhere in this runtime:
 * the platform's own "native" picker spawns a child process that drives the
 * Win32 `IFileOpenDialog` with `FOS_PICKFOLDERS`, and its browse backend
 * returns child directories only, so neither can yield a file. This endpoint
 * therefore spawns the platform's own kind of chooser — `FOS_PICKFOLDERS` left
 * off, this time.
 */
const PICK_PATH = '/plugin-notify-sound/pick-file'

/**
 * Endpoint that accepts an uploaded sound, for a browser that cannot reach the
 * host's file system: it stores the bytes under {@link UPLOAD_DIRECTORY} and
 * answers with the path the sound route can then serve.
 */
const UPLOAD_PATH = '/plugin-notify-sound/upload'

/** Every field the page may override; anything else in a write is ignored. */
const SETTINGS_FIELDS = [
  'notify',
  'sound',
  'soundSource',
  'customSoundPath',
  'toastDurationMs',
  'onlyWhenUnfocused',
]

/** Upper bound for one settings write body. */
const MAX_SETTINGS_BYTES = 64 * 1024

/** Upper bound for one uploaded sound, matching what the sound route will serve. */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024

/** The harness home, resolved the same way the platform resolves it. */
const HARNESS_HOME = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== ''
  ? process.env.DSH_HOME.trim()
  : join(homedir(), '.dsh')

/** Absolute path of this plugin's own settings file. */
const SETTINGS_FILE = join(HARNESS_HOME, 'notify-sound.json')

/** Where an uploaded sound is kept: this plugin's own folder under the home. */
const UPLOAD_DIRECTORY = join(HARNESS_HOME, 'notify-sound-sounds')

/** Upper bound for one served sound file. */
const MAX_SOUND_BYTES = 8 * 1024 * 1024

/** Accepted custom sound extensions mapped to the response content type. */
const MIME_BY_EXTENSION = {
  '.wav': 'audio/wav',
  '.wave': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.webm': 'audio/webm',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
}

/** Selectable sound sources; `custom` reads {@link Settings.customSoundPath}. */
const SOUND_SOURCES = ['chime', 'bell', 'notify', 'custom']

/**
 * Load one package from the installation's runtime table.
 *
 * The installation materializes every package a bundle may import at
 * `$DSH_HOME/profiles/node_modules`. A bundle a profile links from a local
 * directory is not part of the installation, so the ordinary ancestor lookup
 * from this file never reaches that table and a bare specifier only resolves
 * once the running process knows about the link. Resolving the table entry by
 * absolute path therefore comes first, and the bare specifier stays as the
 * fallback for a bundle installed where the ancestor lookup already reaches the
 * installation.
 *
 * @param packageName - full package name, scoped or not.
 * @param usable - whether a loaded namespace is the module being asked for.
 * @returns the module namespace, or undefined when it is unavailable here.
 */
async function loadRuntimeModule(packageName, usable) {
  const segments = packageName.split('/').filter((segment) => segment !== '')
  // The active home first, then the default one: a deployment that points
  // `DSH_HOME` at a directory without a runtime table still finds the
  // installation this process was actually started from.
  const homes = [...new Set([HARNESS_HOME, join(homedir(), '.dsh')])]
  const roots = homes.flatMap((home) => [
    join(home, 'profiles', 'node_modules', ...segments),
    join(home, 'node_modules', ...segments),
  ])
  for (const root of roots) {
    for (const file of ['lib/index.mjs', 'lib/index.js', 'lib/index.cjs']) {
      const path = join(root, file)
      if (!existsSync(path)) continue
      try {
        const namespace = await import(pathToFileURL(path).href)
        if (usable(namespace)) return namespace
      } catch {
        /* try the next candidate */
      }
    }
  }
  try {
    const namespace = await import(packageName)
    if (usable(namespace)) return namespace
  } catch {
    /* the caller falls back to its own defaults */
  }
  return undefined
}

/** Schemastery, so the row carries a schema the platform can resolve and render. */
const schemastery = await loadRuntimeModule(
  '@deepseek-ai/schemastery',
  (namespace) => typeof (namespace.default ?? namespace)?.object === 'function',
)
const z = schemastery === undefined ? undefined : schemastery.default ?? schemastery

/**
 * Read the values the user changed in the configuration page.
 *
 * Only fields that still exist are kept, so a key left behind by an older
 * version of this plugin neither reaches the settings the Host acts on nor
 * shows up as an override the page offers to reset. The next write to the file
 * drops it for good.
 * @returns the stored plain object, or an empty object when absent or unreadable.
 */
function readStoredSettings() {
  try {
    const parsed = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const kept = {}
    for (const [field, value] of Object.entries(parsed)) {
      if (SETTINGS_FIELDS.includes(field)) kept[field] = value
    }
    return kept
  } catch {
    return {}
  }
}

/**
 * Store the user's overrides durably.
 * @param overrides - the complete override object to write.
 * @throws when the file cannot be written.
 */
function writeStoredSettings(overrides) {
  mkdirSync(dirname(SETTINGS_FILE), { recursive: true })
  writeFileSync(SETTINGS_FILE, `${JSON.stringify(overrides, null, 2)}\n`, 'utf8')
}

/** The audio filter every chooser offers, in the Win32 `name|patterns` form. */
const AUDIO_FILTER = `Audio files|${Object.keys(MIME_BY_EXTENSION).map((extension) => `*${extension}`).join(';')}|All files|*.*`

/**
 * Run one child process to completion, collecting its output.
 *
 * The Windows chooser needs a wide child of its own: the dialog must be the
 * process's first window so that Windows activates it, which is also why the
 * platform's own native picker spawns a worker rather than showing a dialog
 * from the Host's own window-less process.
 * @param file - executable to run.
 * @param args - its arguments.
 * @returns the exit code and both streams as text.
 */
function runProcess(file, args) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    } catch (error) {
      reject(error)
      return
    }
    let stdout = ''
    let stderr = ''
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => { stdout += chunk })
    child.stderr?.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

/**
 * Why this deployment cannot show a native chooser, if it cannot.
 *
 * Mirrors the platform's own resolver: the chooser opens on the host's display,
 * so it only makes sense for a browser on this loopback host, launched at a
 * real desktop session rather than over SSH.
 * @param host - the host the Web server bound to.
 * @returns the reason, or undefined when a native chooser is usable.
 */
function nativeChooserBlocker(host) {
  if (typeof host === 'string' && host !== '' && host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    return `the browser is not on this machine (bound to ${host})`
  }
  if (process.env.SSH_CONNECTION !== undefined || process.env.SSH_TTY !== undefined) {
    return 'this host was launched over SSH, so its display is not yours'
  }
  if (process.platform === 'win32' || process.platform === 'darwin' || process.platform === 'linux') return undefined
  return `no native file chooser for ${process.platform}`
}

/**
 * Show the host's own "open file" chooser.
 * @returns the chosen absolute path, or null when the user cancelled.
 * @throws when the platform has no usable chooser.
 */
async function pickNativeFile() {
  if (process.platform === 'win32') {
    // WinForms is present on every supported Windows and needs a single
    // threaded apartment; the dialog is this child's first window.
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
      "$dialog.Title = 'Choose a notification sound'",
      `$dialog.Filter = '${AUDIO_FILTER}'`,
      '$dialog.CheckFileExists = $true',
      '$dialog.Multiselect = $false',
      'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.FileName) }',
    ].join('; ')
    // A packaged app can start with a trimmed PATH, so the usual absolute
    // location is tried before the bare name.
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
    const candidates = [
      join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      'powershell.exe',
      'pwsh.exe',
    ]
    let lastError
    for (const powershell of candidates) {
      try {
        const result = await runProcess(powershell, ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script])
        if (result.code !== 0) throw new Error(`the Windows file chooser exited with ${result.code}: ${result.stderr.trim()}`)
        const chosen = result.stdout.trim()
        return chosen === '' ? null : chosen
      } catch (error) {
        lastError = error
        if (error?.code !== 'ENOENT') throw error
      }
    }
    throw lastError ?? new Error('no PowerShell available to show a file chooser')
  }
  if (process.platform === 'darwin') {
    try {
      const result = await runProcess('osascript', ['-e', 'POSIX path of (choose file with prompt "Choose a notification sound")'])
      const chosen = result.stdout.trim()
      return chosen === '' ? null : chosen
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error('osascript is not available')
      throw error
    }
  }
  const candidates = [
    ['zenity', ['--file-selection', '--title=Choose a notification sound', `--file-filter=${AUDIO_FILTER.replace(/\|/g, ' ')}`]],
    ['kdialog', ['--getopenfilename', '.', `${AUDIO_FILTER.replace(/\|/g, '\n')}`]],
  ]
  for (const [file, args] of candidates) {
    try {
      const result = await runProcess(file, args)
      if (result.code === 1) return null
      if (result.code !== 0) throw new Error(`${file} exited with ${result.code}: ${result.stderr.trim()}`)
      const chosen = result.stdout.trim()
      return chosen === '' ? null : chosen
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }
  }
  throw new Error('no native file chooser found (install zenity or kdialog)')
}

/**
 * Reduce a browser-supplied file name to one safe path segment.
 * @param raw - the `name` a page sent.
 * @returns the safe name, or undefined when nothing usable is left.
 */
function safeSoundName(raw) {
  const base = String(raw).split(/[/\\]/).pop() ?? ''
  // Windows forbids these outright; a colon also carries a drive letter.
  const cleaned = base.replace(/[<>:"|?*\u0000-\u001f]/g, '_').trim()
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return undefined
  return cleaned
}

/** Settings schema projected into the Plugin Manager's configuration form. */
export const Config = z === undefined ? undefined : z.object({
  notify: z.boolean().default(true)
    .description('Notify when a turn finishes, when the agent asks you to choose, and when a tool call needs approval / 开启通知：会话完成、需要你选择、需要你授权'),
  sound: z.boolean().default(true)
    .description('Play a sound / 播放提示音'),
  soundSource: z.union(SOUND_SOURCES.map((value) => z.const(value))).default('chime')
    .description('Sound source: chime, bell, notify, or custom / 提示音音源：chime、bell、notify 或 custom'),
  customSoundPath: z.string().default('')
    .description('Absolute path of the audio file used by soundSource "custom" (.wav/.mp3/.ogg/.m4a/.flac) / soundSource 为 custom 时的音频文件绝对路径'),
  toastDurationMs: z.number().min(1000).max(60000).step(500).default(3000)
    .description('How long a card stays on screen, in milliseconds / 通知停留时间（毫秒）'),
  onlyWhenUnfocused: z.boolean().default(false)
    .description('Stay quiet while the page is focused / 页面在前台时保持安静'),
})

/**
 * Clamp one number into a closed range, replacing anything unusable with the
 * fallback.
 * @param value - candidate value from the row config.
 * @param fallback - value used when the candidate is not a finite number.
 * @param min - inclusive lower bound.
 * @param max - inclusive upper bound.
 * @returns the normalized number.
 */
function clampNumber(value, fallback, min, max) {
  const candidate = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(max, Math.max(min, candidate))
}

/**
 * Resolve the row config into the complete settings object both halves use.
 * Every field is normalized here so a hand-edited `cordis.patch.yml` cannot
 * reach the browser half as something it does not understand.
 * @param config - raw row config, possibly absent or partial.
 * @returns complete settings.
 */
function normalizeSettings(config) {
  const source = config === null || typeof config !== 'object' ? {} : config
  return {
    notify: source.notify !== false,
    sound: source.sound !== false,
    soundSource: SOUND_SOURCES.includes(source.soundSource) ? source.soundSource : 'chime',
    customSoundPath: typeof source.customSoundPath === 'string' ? source.customSoundPath.trim() : '',
    toastDurationMs: clampNumber(source.toastDurationMs, 3000, 1000, 60000),
    onlyWhenUnfocused: source.onlyWhenUnfocused === true,
  }
}

/**
 * Whether one Agent belongs to a Session the user started, rather than to a
 * subagent or workflow child. Child sessions finish constantly; notifying for
 * each of them would bury the notifications that matter.
 * @param agent - the Agent carried by a Host event, possibly absent.
 * @returns true when the owning Session has no parent Session.
 */
function isUserFacing(agent) {
  try {
    return agent?.session?.header?.parentSession === undefined
  } catch {
    return true
  }
}

/**
 * The short project label for one Agent, used as the card's context line.
 * @param agent - the Agent carried by a Host event, possibly absent.
 * @returns the working directory's base name, or undefined when unavailable.
 */
function projectOf(agent) {
  try {
    const cwd = agent?.session?.header?.cwd
    if (typeof cwd !== 'string' || cwd === '') return undefined
    return basename(cwd) || undefined
  } catch {
    return undefined
  }
}

/**
 * Mount the notification transport.
 * @param ctx - plugin context carrying `webServer`.
 * @param config - row config validated by {@link Config} when that schema loaded.
 */
export function apply(ctx, config) {
  /** The values the user changed in the configuration page, above `config`. */
  let overrides = readStoredSettings()
  /** Current settings: the composition row, then the stored overrides. */
  let settings = normalizeSettings({ ...config, ...overrides })
  /**
   * Bumped whenever an uploaded sound replaces the bytes behind one path, so
   * the page can tell that a cached sound of the same name is stale.
   */
  let soundRevisionSeq = 0
  /** Open SSE responses. */
  const clients = new Set()
  /** Agent ids currently observed as running, so the first idle is a real finish. */
  const running = new Set()
  /** One cache entry for the configured custom sound, keyed by path and mtime. */
  let cachedSound = { path: undefined, mtimeMs: 0, bytes: undefined }
  /** Monotonic part of a notice id; the timestamp alone can repeat. */
  let noticeSeq = 0
  /** Activation steps the browser half has reported, newest last. */
  const clientReports = []

  // An Agent that is already running when this plugin activates still has its
  // finish reported: the `running` edge happened before the listener existed,
  // so the live registry seeds the marker.
  try {
    for (const agent of ctx.get('agents')?.list?.() ?? []) {
      if (agent?.status === 'running' && agent.id !== undefined) running.add(agent.id)
    }
  } catch {
    /* the Agent registry is optional; without it the first Turn is simply missed */
  }

  /**
   * Write one frame to every connected page. A response that already closed
   * throws here rather than anywhere that matters, so it is dropped silently.
   * @param frame - JSON-serializable frame.
   */
  const broadcast = (frame) => {
    if (clients.size === 0) return
    const line = `data: ${JSON.stringify(frame)}\n\n`
    for (const response of [...clients]) {
      try {
        response.write(line)
      } catch {
        clients.delete(response)
      }
    }
  }

  /**
   * Whether notifications are on at all; when they are off, the Host does no
   * work. The card and the Windows notification are always part of a notice;
   * only the sound has a switch of its own.
   * @returns true when a notice has somewhere to go.
   */
  const anyChannel = () => settings.notify

  /**
   * Broadcast one notice to the browser half.
   * @param kind - `turn-end`, `question`, or `approval`.
   * @param extra - additional frame fields the browser half formats.
   */
  const notice = (kind, extra) => {
    if (!anyChannel()) return
    noticeSeq += 1
    broadcast({
      type: 'notice',
      notice: {
        id: `${Date.now().toString(36)}-${String(noticeSeq)}`,
        kind,
        at: Date.now(),
        ...extra,
      },
    })
  }

  /**
   * Read the configured custom sound, reusing the cached bytes while the file's
   * modification time is unchanged.
   * @param path - absolute path from the settings.
   * @returns the file bytes.
   * @throws when the path is not a readable regular file within the size bound.
   */
  const readSound = async (path) => {
    const info = await stat(path)
    if (!info.isFile()) throw new Error('not a regular file')
    if (info.size > MAX_SOUND_BYTES) throw new Error(`file is larger than ${String(MAX_SOUND_BYTES)} bytes`)
    if (cachedSound.path === path && cachedSound.mtimeMs === info.mtimeMs && cachedSound.bytes !== undefined) {
      return cachedSound.bytes
    }
    const bytes = await readFile(path)
    cachedSound = { path, mtimeMs: info.mtimeMs, bytes }
    return bytes
  }

  /** Open one SSE stream, announcing the current settings first. */
  const handleEvents = (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end()
      return
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
    })
    res.write(': connected\n\n')
    clients.add(res)
    res.write(`data: ${JSON.stringify({
      type: 'hello',
      settings,
      overrides,
      soundRevision: `${encodeURIComponent(settings.customSoundPath)}#${String(soundRevisionSeq)}`,
    })}\n\n`)
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    const drop = () => {
      clients.delete(res)
    }
    res.on('close', drop)
    res.on('error', drop)
  }

  /** Serve the configured custom sound file to the page. */
  const handleSound = (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end()
      return
    }
    if (settings.soundSource !== 'custom' || settings.customSoundPath === '') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('notify-sound: no custom sound configured')
      return
    }
    const path = settings.customSoundPath
    readSound(path).then((bytes) => {
      res.writeHead(200, {
        'content-type': MIME_BY_EXTENSION[extname(path).toLowerCase()] ?? 'application/octet-stream',
        'content-length': String(bytes.byteLength),
        'cache-control': 'no-store',
      })
      if (req.method === 'HEAD') res.end()
      else res.end(bytes)
    }).catch((error) => {
      ctx.logger.warn(`notify-sound: cannot serve the custom sound "${path}": ${String(error?.message ?? error)}`)
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`notify-sound: cannot read ${path}: ${String(error?.message ?? error)}`)
    })
  }

  /**
   * Collect one progress report from the browser half, or serve the reports
   * collected so far. The page cannot be inspected from here, so the page
   * reports its own activation steps through this route; `GET` without a
   * `stage` parameter answers the JSON list for diagnosis.
   */
  const handleReport = (req, res) => {
    const url = new URL(req.url ?? '/', 'http://dsh.invalid')
    const stage = url.searchParams.get('stage')
    if (stage === null) {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(`${JSON.stringify(clientReports, null, 2)}\n`)
      return
    }
    clientReports.push({
      at: new Date().toISOString(),
      stage,
      detail: url.searchParams.get('detail'),
    })
    res.writeHead(204)
    res.end()
  }

  /**
   * Serve the configuration page's reads and writes.
   *
   * `GET` answers the effective settings and the raw overrides behind them, so
   * the page can mark which fields the user changed. `POST` accepts a partial
   * patch over those fields, where `null` clears an override; the merged result
   * is validated against {@link Config} when that schema loaded, written to
   * {@link SETTINGS_FILE}, and pushed to every open page.
   */
  const handleSettingsRoute = (req, res) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      if (req.method === 'HEAD') res.end()
      else res.end(`${JSON.stringify({ settings, overrides, file: SETTINGS_FILE }, null, 2)}\n`)
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    let body = ''
    let settled = false
    req.on('data', (chunk) => {
      if (settled) return
      body += chunk
      if (body.length > MAX_SETTINGS_BYTES) {
        settled = true
        res.writeHead(413, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('settings payload too large')
      }
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      let patch
      try {
        patch = JSON.parse(body)
      } catch {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('invalid JSON body')
        return
      }
      if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('expected a JSON object')
        return
      }
      const next = { ...overrides }
      for (const [field, value] of Object.entries(patch)) {
        if (!SETTINGS_FIELDS.includes(field)) continue
        if (value === null) delete next[field]
        else next[field] = value
      }
      const candidate = { ...config, ...next }
      if (z !== undefined && Config !== undefined) {
        const result = Config['~standard'].validate(candidate)
        if (result.issues !== undefined) {
          res.writeHead(422, { 'content-type': 'application/json; charset=utf-8' })
          res.end(`${JSON.stringify({ issues: result.issues })}\n`)
          return
        }
      }
      try {
        writeStoredSettings(next)
      } catch (error) {
        ctx.logger.warn(`notify-sound: cannot write "${SETTINGS_FILE}": ${String(error?.message ?? error)}`)
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
        res.end(`cannot write ${SETTINGS_FILE}`)
        return
      }
      overrides = next
      settings = normalizeSettings({ ...config, ...overrides })
      broadcast({
        type: 'settings',
        settings,
        overrides,
        soundRevision: `${encodeURIComponent(settings.customSoundPath)}#${String(soundRevisionSeq)}`,
      })
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(`${JSON.stringify({ settings, overrides }, null, 2)}\n`)
    })
    req.on('error', () => {
      if (settled) return
      settled = true
      res.writeHead(400)
      res.end()
    })
  }

  /**
   * Open the host's own file chooser and answer with what the user picked.
   *
   * Electron's `dialog` is not reachable from here: the desktop app runs this
   * Host as an `ELECTRON_RUN_AS_NODE` child of its main process, where
   * `require('electron')` yields the binary path rather than the API — and no
   * installed package touches Electron at all. A native chooser is therefore
   * opened the way the platform opens its own: a spawned child process whose
   * first window Windows activates. When the operator is not at this machine's
   * screen (a remote browser, an SSH launch, an unsupported platform) the
   * answer is `available: false`, and the page falls back to a browser file
   * input plus {@link handleUploadRoute}.
   */
  const handlePickFileRoute = (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    const answer = (payload) => {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(`${JSON.stringify(payload)}\n`)
    }
    const blocker = nativeChooserBlocker(ctx.webServer?.host)
    if (blocker !== undefined) {
      answer({ available: false, reason: blocker })
      return
    }
    pickNativeFile().then((path) => {
      answer({ available: true, path })
    }).catch((error) => {
      const message = String(error?.message ?? error)
      ctx.logger.warn(`notify-sound: native file chooser failed: ${message}`)
      answer({ available: false, reason: message })
    })
  }

  /**
   * Store one sound the page uploaded, for a browser that cannot reach this
   * machine's file system. The body is the file itself and `name` is what the
   * browser called it; the stored name keeps only the last path segment and
   * loses the characters Windows forbids in a file name.
   */
  const handleUploadRoute = (req, res) => {
    const fail = (status, message) => {
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(message)
    }
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    const url = new URL(req.url ?? '/', 'http://dsh.invalid')
    const name = safeSoundName(url.searchParams.get('name') ?? '')
    if (name === undefined) {
      fail(400, 'a usable file name is required')
      return
    }
    if (MIME_BY_EXTENSION[extname(name).toLowerCase()] === undefined) {
      fail(415, `unsupported audio extension: ${extname(name)}`)
      return
    }
    const chunks = []
    let size = 0
    let settled = false
    req.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > MAX_UPLOAD_BYTES) {
        settled = true
        fail(413, `sound larger than ${MAX_UPLOAD_BYTES} bytes`)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      if (size === 0) {
        fail(400, 'the uploaded sound is empty')
        return
      }
      const target = join(UPLOAD_DIRECTORY, name)
      try {
        mkdirSync(UPLOAD_DIRECTORY, { recursive: true })
        writeFileSync(target, Buffer.concat(chunks))
      } catch (error) {
        ctx.logger.warn(`notify-sound: cannot store the uploaded sound: ${String(error?.message ?? error)}`)
        fail(500, `cannot write ${target}`)
        return
      }
      // The bytes behind an unchanged path just changed, so the served sound
      // needs a new revision or the page keeps playing the cached one.
      soundRevisionSeq += 1
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(`${JSON.stringify({ path: target })}\n`)
    })
    req.on('error', () => {
      if (settled) return
      settled = true
      res.writeHead(400)
      res.end()
    })
  }

  ctx.effect(() => {
    const disposeEvents = ctx.webServer.register({ kind: 'exact', path: EVENTS_PATH, handler: handleEvents })
    const disposeSound = ctx.webServer.register({ kind: 'exact', path: SOUND_PATH, handler: handleSound })
    const disposeReport = ctx.webServer.register({ kind: 'exact', path: REPORTS_PATH, handler: handleReport })
    const disposeSettings = ctx.webServer.register({ kind: 'exact', path: SETTINGS_PATH, handler: handleSettingsRoute })
    const disposePick = ctx.webServer.register({ kind: 'exact', path: PICK_PATH, handler: handlePickFileRoute })
    const disposeUpload = ctx.webServer.register({ kind: 'exact', path: UPLOAD_PATH, handler: handleUploadRoute })
    return () => {
      disposeEvents()
      disposeSound()
      disposeReport()
      disposeSettings()
      disposePick()
      disposeUpload()
      // Dropping the streams is what makes a reloaded Host push its new
      // settings: EventSource reconnects and receives a fresh `hello`.
      for (const response of clients) {
        try {
          response.destroy()
        } catch {
          /* the stream was already gone */
        }
      }
      clients.clear()
    }
  }, 'notify-sound: web routes')

  // --- Turn finished ------------------------------------------------------

  ctx.on('agent/status', (payload) => {
    const agent = payload?.agent
    if (agent === undefined || agent === null) return
    if (payload.status === 'running') {
      running.add(agent.id)
      return
    }
    if (payload.status !== 'idle') return
    // Only a `running -> idle` edge is a finished Turn; the idle an Agent is
    // created with is not.
    if (!running.delete(agent.id)) return
    if (!isUserFacing(agent)) return
    notice('turn-end', { project: projectOf(agent) })
  })

  ctx.on('agent/disposed', (payload) => {
    const agent = payload?.agent
    if (agent !== undefined && agent !== null) running.delete(agent.id)
  })

  // --- The agent needs a choice ------------------------------------------

  /** Guards against two question signals of one build reporting one ask twice. */
  let lastQuestionAt = 0

  /**
   * The first question's text out of a parsed `ask_user_question` argument
   * object or a user-questions request.
   * @param value - parsed arguments or a request carrying `questions`.
   * @returns the question text, or undefined when it cannot be read.
   */
  const questionText = (value) => {
    const list = value?.questions
    const first = Array.isArray(list) ? list[0] : undefined
    return typeof first?.question === 'string' && first.question !== '' ? first.question : undefined
  }

  /**
   * Announce one pending question, at most once per ask.
   * @param body - the question text, when it could be read.
   * @param agent - the owning Agent, when the caller has one.
   */
  const noticeQuestion = (body, agent) => {
    // While notifications are off nothing is announced, so the guard must not
    // advance either: otherwise an ask that arrived in that window would
    // swallow the first ask after the switch came back on.
    if (!settings.notify) return
    const now = Date.now()
    if (now - lastQuestionAt < 2000) return
    lastQuestionAt = now
    notice('question', { body, project: projectOf(agent) })
  }

  // `tools/pre-execute` is where every composition asks: the model-facing
  // `ask_user_question` tool passes through the policy pipeline before the
  // question reaches the user, whichever UI service answers it.
  ctx.on('tools/pre-execute', function questionNotice(exec, next) {
    try {
      if (exec?.name === 'ask_user_question' && (exec.agent === undefined || isUserFacing(exec.agent))) {
        noticeQuestion(questionText(exec.arguments), exec.agent)
      }
    } catch (error) {
      ctx.logger.warn(`notify-sound: question notice failed: ${String(error?.message ?? error)}`)
    }
    return next()
  })

  // A composition that also publishes the ask as a scoped event reports the
  // same request a second time; whichever arrives first wins and the guard in
  // `noticeQuestion` drops the other.
  ctx.on('user-questions/request', function userQuestionNotice(request, next) {
    try {
      const agent = request?.agent
      if (agent === undefined || isUserFacing(agent)) noticeQuestion(questionText(request), agent)
    } catch (error) {
      ctx.logger.warn(`notify-sound: question notice failed: ${String(error?.message ?? error)}`)
    }
    return next()
  })

  // --- A tool call needs approval ----------------------------------------

  ctx.on('approval/request', function approvalNotice(request, next) {
    try {
      const agent = request?.agent
      if (agent === undefined || isUserFacing(agent)) {
        const displayReason = request?.displayReason
        const reason = typeof request?.reason === 'string' && request.reason !== '' ? request.reason : undefined
        const tool = typeof request?.toolName === 'string' && request.toolName !== '' ? request.toolName : undefined
        notice('approval', {
          reason,
          displayReason: displayReason !== null && typeof displayReason === 'object' ? displayReason : undefined,
          tool,
          project: projectOf(agent),
        })
      }
    } catch (error) {
      ctx.logger.warn(`notify-sound: approval notice failed: ${String(error?.message ?? error)}`)
    }
    return next()
  })
}
