/**
 * Browser half of `@local/dsh-notify-sound`.
 *
 * It renders one frame-wide entry in the `shell.overlay` slot: a stack of
 * Windows-style notification cards anchored to the top-right corner of the
 * window, with an accent bar per notice kind, a close button, and a timed
 * dismissal. Alongside the card it synthesizes three built-in sounds through
 * the Web Audio API, plays the configured custom file through the Host's sound
 * route, and raises a Windows system notification through the Notification API.
 *
 * No Harness Client package is imported: React comes from the browser module
 * table, and the styling uses only `--dsw-alias-*` theme tokens.
 *
 * @module @local/dsh-notify-sound/client
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-notify-sound',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Dictionary namespace owned by this plugin. */
    const NS = 'notifySound'

    /**
     * Push channel, document-relative like every other plugin route, so it
     * resolves under whatever mount the page is served from.
     */
    const EVENTS_ROUTE = 'plugin-notify-sound/events'

    /** Custom sound route, document-relative for the same reason. */
    const SOUND_ROUTE = 'plugin-notify-sound/sound'

    /** Activation-report route, document-relative for the same reason. */
    const REPORT_ROUTE = 'plugin-notify-sound/report'

    /** Settings route the configuration page reads and writes. */
    const SETTINGS_ROUTE = 'plugin-notify-sound/settings'

    /** Route that opens this machine's own file chooser. */
    const PICK_ROUTE = 'plugin-notify-sound/pick-file'

    /** Route that accepts a sound uploaded from a browser that cannot reach it. */
    const UPLOAD_ROUTE = 'plugin-notify-sound/upload'

    /** Extensions an upload may use: what the sound route can serve. */
    const AUDIO_EXTENSIONS = ['.wav', '.wave', '.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.flac', '.webm', '.aif', '.aiff']

    /**
     * Ask the Host to open this machine's file chooser.
     * @param outcome - receives the chosen path, null when the user cancelled,
     * or undefined when this deployment has no native chooser at all.
     */
    function pickFileOnHost(outcome) {
      try {
        fetch(PICK_ROUTE, { method: 'POST' }).then((response) => (
          response.ok ? response.json() : Promise.reject(new Error(String(response.status)))
        )).then((value) => {
          if (value?.available === false) outcome(undefined)
          else outcome(typeof value?.path === 'string' ? value.path : null)
        }).catch(() => {
          outcome(undefined)
        })
      } catch {
        outcome(undefined)
      }
    }

    /**
     * Copy one browser-chosen file to the Host and answer with where it landed.
     * @param file - the file from an `<input type="file">`.
     * @param outcome - receives the stored absolute path, or undefined on failure.
     */
    function uploadSound(file, outcome) {
      try {
        fetch(`${UPLOAD_ROUTE}?name=${encodeURIComponent(file.name)}`, {
          method: 'POST',
          headers: { 'content-type': file.type === '' ? 'application/octet-stream' : file.type },
          body: file,
        }).then((response) => (
          response.ok ? response.json() : Promise.reject(new Error(String(response.status)))
        )).then((value) => {
          outcome(typeof value?.path === 'string' ? value.path : undefined)
        }).catch(() => {
          outcome(undefined)
        })
      } catch {
        outcome(undefined)
      }
    }

    /**
     * @param name - a file name.
     * @returns the lower-case extension including its dot, or an empty string.
     */
    function extensionOf(name) {
      const dot = name.lastIndexOf('.')
      return dot > 0 ? name.slice(dot).toLowerCase() : ''
    }

    /**
     * Send one settings patch to the Host. `null` on a field clears the user's
     * override for it, returning that field to the composition default.
     * @param patch - partial update over the settings fields.
     * @param settled - receives whether the Host accepted and stored it.
     */
    function saveSettingsPatch(patch, settled) {
      try {
        fetch(SETTINGS_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        }).then((response) => {
          settled?.(response.ok)
        }).catch(() => {
          settled?.(false)
        })
      } catch {
        settled?.(false)
      }
    }

    /**
     * Tell the Host how far this half got. The page cannot be inspected from the
     * Host side, so each activation step is reported through a fire-and-forget
     * request the Host collects for diagnosis.
     * @param stage - the step being reported.
     * @param detail - extra facts about that step.
     */
    function report(stage, detail) {
      try {
        const url = `${REPORT_ROUTE}?stage=${encodeURIComponent(stage)}`
          + `&detail=${encodeURIComponent(JSON.stringify(detail ?? null))}`
        fetch(url).catch(() => {})
      } catch {
        /* the report itself must never break activation */
      }
    }

    /** Settings used until the Host's `hello` frame arrives. */
    const DEFAULT_SETTINGS = {
      notify: true,
      sound: true,
      soundSource: 'chime',
      customSoundPath: '',
      toastDurationMs: 3000,
      onlyWhenUnfocused: false,
    }

    /**
     * How many cards the stack keeps. The Host no longer offers a setting for
     * this; three is the number that stayed readable in practice.
     */
    const MAX_TOASTS = 3

    /**
     * Playback level for every sound. There is no volume control, so this is
     * full level; the built-in tones scale their own partials from it.
     */
    const PLAYBACK_LEVEL = 1

    /** Every visible string this plugin owns, in both shipped locales. */
    const DICTIONARIES = {
      en: {
        'notice.turnEnd.title': 'Turn finished',
        'notice.turnEnd.body': 'The agent stopped and is waiting for your next instruction.',
        'notice.question.title': 'Your input is needed',
        'notice.question.body': 'The agent is waiting for you to choose.',
        'notice.approval.title': 'Approval needed',
        'notice.approval.body': 'A tool call is waiting for your approval.',
        'notice.dismiss': 'Dismiss this notification',
        'settings.title': 'Notifications and sounds',
        'settings.tabLabel': 'Notifications and sounds',
        'settings.intro': 'Stored in this machine\u2019s plugin settings file and applied immediately; a field marked Changed overrides the composition default.',
        'settings.save': 'Save',
        'settings.discard': 'Discard',
        'settings.saving': 'Saving…',
        'settings.saveFailed': 'The settings could not be saved.',
        'settings.resetAll': 'Reset all to defaults',
        'settings.reset': 'Use the default',
        'settings.overridden': 'Changed',
        'settings.staged': 'Unsaved',
        'settings.browse': 'Browse…',
        'settings.browseHint': 'Opens this machine\u2019s file chooser; in a browser that cannot reach it, pick a file to copy in instead.',
        'settings.picking': 'Waiting for the file chooser…',
        'settings.pickFailed': 'The file chooser closed without a usable file.',
        'settings.uploading': 'Copying the file…',
        'settings.uploadFailed': 'The file could not be copied.',
        'settings.loading': 'Reading the settings…',
        'settings.group.notify': 'Notifications',
        'settings.group.sound': 'Sound',
        'settings.group.card': 'Notification card',
        'field.notify': 'Notifications (turn finished, approval, choice)',
        'field.sound': 'Play a sound',
        'field.soundSource': 'Sound source',
        'field.customSoundPath': 'Custom audio file',
        'field.customSoundPath.hint': 'Used when the sound source is "custom". Press Browse… to pick a .wav/.mp3/.ogg/.m4a/.flac file.',
        'field.toastDurationMs': 'Card duration (ms)',
        'field.onlyWhenUnfocused': 'Stay quiet while the page is focused',
        'option.chime': 'Chime (two-note bell)',
        'option.bell': 'Bell (single soft tone)',
        'option.notify': 'Notify (rising three-note cue)',
        'option.custom': 'Custom file',
      },
      zh: {
        'notice.turnEnd.title': '会话已完成',
        'notice.turnEnd.body': 'Agent 已停止工作，等待你的下一条指令。',
        'notice.question.title': '需要你的选择',
        'notice.question.body': 'Agent 正在等待你做出选择。',
        'notice.approval.title': '需要你的授权',
        'notice.approval.body': '有工具调用正在等待你的授权。',
        'notice.dismiss': '关闭这条通知',
        'settings.title': '通知与提示音',
        'settings.tabLabel': '通知与提示音',
        'settings.intro': '保存在本机的插件设置文件中并立即生效；带「已修改」标记的字段会覆盖组合行里的默认值。',
        'settings.save': '保存',
        'settings.discard': '放弃修改',
        'settings.saving': '保存中…',
        'settings.saveFailed': '设置保存失败。',
        'settings.resetAll': '全部恢复默认',
        'settings.reset': '恢复默认',
        'settings.overridden': '已修改',
        'settings.staged': '未保存',
        'settings.browse': '浏览…',
        'settings.browseHint': '打开本机的文件选择框；如果浏览器不在这台机器上，则改为选择文件并复制过来。',
        'settings.picking': '等待文件选择框…',
        'settings.pickFailed': '文件选择框已关闭，没有可用的文件。',
        'settings.uploading': '正在复制文件…',
        'settings.uploadFailed': '文件复制失败。',
        'settings.loading': '正在读取设置…',
        'settings.group.notify': '通知',
        'settings.group.sound': '提示音',
        'settings.group.card': '通知卡片',
        'field.notify': '开启通知（会话完成、需要授权、需要选择）',
        'field.sound': '播放提示音',
        'field.soundSource': '提示音音源',
        'field.customSoundPath': '自定义音频文件',
        'field.customSoundPath.hint': '仅在音源选择「自定义文件」时使用。点「浏览…」选择 .wav/.mp3/.ogg/.m4a/.flac 文件。',
        'field.toastDurationMs': '通知停留时间（毫秒）',
        'field.onlyWhenUnfocused': '页面在前台时保持安静',
        'option.chime': '清脆铃声（两声）',
        'option.bell': '柔和钟声（单声）',
        'option.notify': '完成提示（上行三音）',
        'option.custom': '自定义文件',
      },
    }

    /**
     * The stack stylesheet, rendered as a React element inside the plugin's own
     * entry so unmounting removes it with the component. Only `--dsw-alias-*`
     * tokens carry color, so light and dark themes both read correctly.
     */
    const STYLES = [
      '.dsh-ns-stack{position:fixed;top:16px;right:16px;z-index:2147483000;display:flex;flex-direction:column;gap:10px;width:min(360px,calc(100vw - 32px));pointer-events:none}',
      '.dsh-ns-card{position:relative;display:flex;align-items:flex-start;gap:10px;box-sizing:border-box;padding:12px 12px 12px 17px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-overlay);box-shadow:0 8px 24px rgba(0,0,0,.22),0 2px 6px rgba(0,0,0,.12);color:var(--dsw-alias-label-primary);pointer-events:auto;animation:dsh-ns-in 180ms ease-out}',
      '.dsh-ns-accent{position:absolute;top:0;bottom:0;left:0;width:3px;border-radius:8px 0 0 8px;background:var(--dsw-alias-brand-primary)}',
      '.dsh-ns-card[data-kind="turn-end"] .dsh-ns-accent{background:var(--dsw-alias-state-success-primary)}',
      '.dsh-ns-card[data-kind="question"] .dsh-ns-accent,.dsh-ns-card[data-kind="approval"] .dsh-ns-accent{background:var(--dsw-alias-state-warn-primary)}',
      '.dsh-ns-body{flex:1 1 auto;min-width:0}',
      '.dsh-ns-title{font-size:13px;font-weight:600;line-height:18px}',
      '.dsh-ns-text{margin-top:3px;font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary);word-break:break-word}',
      '.dsh-ns-meta{margin-top:4px;overflow:hidden;font-size:11px;line-height:15px;color:var(--dsw-alias-label-secondary);opacity:.8;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-ns-close{flex:0 0 auto;width:20px;height:20px;margin:0;padding:0;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:15px;line-height:1;cursor:pointer}',
      '.dsh-ns-close:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '@keyframes dsh-ns-in{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}',
    ].join('')

    /** Settings namespace this plugin owns; the Host registers the same name. */
    const SETTINGS_NS = 'notify-sound'

    /**
     * Every editable setting, in display order. `kind` selects the control; the
     * numeric bounds mirror the Host schema, which validates the write anyway.
     */
    const SETTINGS_FIELDS = [
      { field: 'notify', kind: 'switch', group: 'settings.group.notify' },
      { field: 'onlyWhenUnfocused', kind: 'switch' },
      { field: 'sound', kind: 'switch', group: 'settings.group.sound' },
      { field: 'soundSource', kind: 'select', options: ['chime', 'bell', 'notify', 'custom'] },
      { field: 'customSoundPath', kind: 'path', hint: true },
      { field: 'toastDurationMs', kind: 'number', min: 1000, max: 60000, step: 500, group: 'settings.group.card' },
    ]

    /**
     * The settings card's stylesheet, rendered inside the card like the toast
     * stack's so unmounting removes it. Only `--dsw-alias-*` tokens carry
     * color, and the row geometry follows the shipped settings cards.
     */
    const SETTINGS_STYLES = [
      '.dsh-ns-panel{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:16px 18px}',
      '.dsh-ns-panel-head{display:flex;align-items:flex-start;gap:12px}',
      '.dsh-ns-panel-title{flex:1 1 auto;min-width:0;font-size:14px;font-weight:600;line-height:20px}',
      '.dsh-ns-panel-intro{margin:4px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-ns-panel-actions{display:flex;flex:0 0 auto;align-items:center;gap:8px}',
      '.dsh-ns-btn{font:inherit;font-size:12px;line-height:1.5;padding:5px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);cursor:pointer}',
      '.dsh-ns-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l1)}',
      '.dsh-ns-btn:disabled{cursor:default;color:var(--dsw-alias-label-tertiary)}',
      '.dsh-ns-btn-primary{border-color:transparent;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}',
      '.dsh-ns-field{display:flex;flex-direction:column;gap:6px;padding:12px 0}',
      '.dsh-ns-field+.dsh-ns-field{border-top:1px solid var(--dsw-alias-border-l2)}',
      '.dsh-ns-group{margin:16px 0 0;font-size:12px;font-weight:600;line-height:18px;letter-spacing:.02em;color:var(--dsw-alias-label-tertiary);text-transform:uppercase}',
      '.dsh-ns-group+.dsh-ns-field{padding-top:6px}',
      '.dsh-ns-field-head{display:flex;align-items:center;gap:8px}',
      '.dsh-ns-field-label{flex:1 1 auto;min-width:0;font-size:13px;font-weight:500;line-height:1.5}',
      '.dsh-ns-field-hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
      '.dsh-ns-badge{flex:0 0 auto;font-size:11px;line-height:17px;padding:1px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}',
      '.dsh-ns-reset{font:inherit;font-size:12px;line-height:1.5;padding:0;border:0;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.dsh-ns-reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}',
      '.dsh-ns-input{box-sizing:border-box;width:100%;height:34px;font:inherit;font-size:13px;line-height:1.5;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}',
      '.dsh-ns-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}',
      '.dsh-ns-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}',
      '.dsh-ns-range{height:auto;padding:0;border:0;background:none}',
      '.dsh-ns-switch{flex:0 0 auto;position:relative;width:36px;height:20px;padding:0;border:0;border-radius:999px;background:var(--dsw-alias-state-idle-primary);cursor:pointer;transition:background 120ms ease}',
      '.dsh-ns-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}',
      '.dsh-ns-switch:disabled{cursor:default;opacity:.5}',
      '.dsh-ns-switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-base);transition:transform 120ms ease}',
      '.dsh-ns-switch[aria-checked="true"]::after{transform:translateX(16px)}',
      '.dsh-ns-note{margin:8px 0 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '.dsh-ns-note-error{color:var(--dsw-alias-state-error-primary)}',
      '.dsh-ns-path{display:flex;align-items:center;gap:8px}',
      '.dsh-ns-path .dsh-ns-input{flex:1 1 auto;min-width:0}',
      // The field is the part that may shrink; the button keeps its own width,
      // and its label never wraps.
      '.dsh-ns-path .dsh-ns-btn{flex:0 0 auto;white-space:nowrap;padding:5px 14px}',
    ].join('')

    /**
     * Clamp one number into a closed range.
     * @param value - candidate value.
     * @param fallback - value used when the candidate is unusable.
     * @param min - inclusive lower bound.
     * @param max - inclusive upper bound.
     * @returns the normalized number.
     */
    function clampNumber(value, fallback, min, max) {
      const candidate = typeof value === 'number' && Number.isFinite(value) ? value : fallback
      return Math.min(max, Math.max(min, candidate))
    }

    /**
     * Normalize the settings frame. The Host already normalizes them; this keeps
     * a truncated or hand-written frame from reaching the render path.
     * @param value - settings from a frame.
     * @returns complete settings.
     */
    function normalizeSettings(value) {
      const source = value === null || typeof value !== 'object' ? {} : value
      const sources = ['chime', 'bell', 'notify', 'custom']
      return {
        notify: source.notify !== false,
        sound: source.sound !== false,
        soundSource: sources.indexOf(source.soundSource) >= 0 ? source.soundSource : 'chime',
        customSoundPath: typeof source.customSoundPath === 'string' ? source.customSoundPath : '',
        toastDurationMs: clampNumber(source.toastDurationMs, 3000, 1000, 60000),
        onlyWhenUnfocused: source.onlyWhenUnfocused === true,
      }
    }

    /** The notification store; the components subscribe, the transport writes. */
    function createStore() {
      let state = { settings: DEFAULT_SETTINGS, overrides: {}, revision: '', received: false, notices: [] }
      const listeners = new Set()
      const publish = (next) => {
        state = next
        for (const listener of [...listeners]) listener()
      }
      return {
        /** @returns the current immutable state. */
        getSnapshot: () => state,
        /**
         * @param listener - notified after every change.
         * @returns unsubscribe.
         */
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        /**
         * @param settings - newest effective settings from the Host.
         * @param overrides - the fields the user changed, as stored on the Host.
         * @param revision - the sound revision the Host last published.
         */
        setSettings(settings, overrides, revision) {
          publish({
            ...state,
            settings,
            overrides: overrides !== null && typeof overrides === 'object' ? overrides : {},
            revision: typeof revision === 'string' ? revision : state.revision,
            received: true,
          })
        },
        /** @param next - newest notice, kept at the head of the stack. */
        push(next) {
          const limit = MAX_TOASTS
          publish({ ...state, notices: [next, ...state.notices].slice(0, limit) })
        },
        /** @param id - notice to remove. */
        dismiss(id) {
          const kept = state.notices.filter((item) => item.id !== id)
          if (kept.length !== state.notices.length) publish({ ...state, notices: kept })
        },
      }
    }

    const store = createStore()

    /**
     * The Host's last published sound revision. It changes when an uploaded
     * file replaces the bytes behind one path, which is what keeps the browser
     * from replaying a sound it cached before.
     */
    let soundRevision = ''

    /** Bound translator, replaced by the locale service in `apply`. */
    let translate = (key) => key

    // --- Sound ------------------------------------------------------------

    /** Lazily created shared AudioContext. */
    let audioContext

    /**
     * The shared audio engine, resumed on demand. Autoplay policy leaves it
     * suspended until the page has seen a user gesture, which in this
     * application the first submitted prompt provides.
     * @returns the engine, or undefined when the browser has no Web Audio.
     */
    function audioEngine() {
      const Ctor = window.AudioContext ?? window.webkitAudioContext
      if (typeof Ctor !== 'function') return undefined
      if (audioContext === undefined) {
        try {
          audioContext = new Ctor()
        } catch {
          return undefined
        }
      }
      if (audioContext.state === 'suspended') {
        const resumed = audioContext.resume()
        if (resumed !== undefined && typeof resumed.catch === 'function') resumed.catch(() => {})
      }
      return audioContext
    }

    /**
     * Schedule one enveloped tone.
     * @param engine - the audio engine.
     * @param frequency - tone frequency in hertz.
     * @param offset - start offset in seconds from now.
     * @param duration - length in seconds.
     * @param peak - peak gain.
     * @param type - oscillator waveform.
     */
    function tone(engine, frequency, offset, duration, peak, type) {
      const start = engine.currentTime + offset
      const oscillator = engine.createOscillator()
      const gain = engine.createGain()
      oscillator.type = type ?? 'sine'
      oscillator.frequency.setValueAtTime(frequency, start)
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.001), start + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
      oscillator.connect(gain)
      gain.connect(engine.destination)
      oscillator.start(start)
      oscillator.stop(start + duration + 0.03)
    }

    /**
     * The three built-in sounds, synthesized so the plugin ships no assets.
     * Each takes the shared playback level and scales its own partials from it.
     */
    const BUILT_IN_SOUNDS = {
      /** Bright two-note chime. */
      chime(engine, level) {
        tone(engine, 987.77, 0, 0.18, level * 0.5)
        tone(engine, 1318.51, 0.11, 0.42, level * 0.42)
      },
      /** Single soft bell with a lower overtone. */
      bell(engine, level) {
        tone(engine, 659.25, 0, 0.5, level * 0.5)
        tone(engine, 987.77, 0.02, 0.42, level * 0.22, 'triangle')
      },
      /** Rising three-note completion cue. */
      notify(engine, level) {
        tone(engine, 523.25, 0, 0.16, level * 0.45)
        tone(engine, 659.25, 0.12, 0.16, level * 0.45)
        tone(engine, 783.99, 0.24, 0.34, level * 0.5)
      },
    }

    /**
     * Play the configured custom file through the Host's sound route.
     * @param settings - current settings.
     * @param level - playback level; the page always uses {@link PLAYBACK_LEVEL}.
     * @returns true when playback started, so the caller does not fall back.
     */
    function playCustomSound(settings, level) {
      try {
        // The revision makes a replaced-but-same-named file a different URL, so
        // the browser cannot keep playing the bytes it cached before.
        const revision = soundRevision === '' ? '' : `&r=${encodeURIComponent(soundRevision)}`
        const audio = new Audio(`${SOUND_ROUTE}?p=${encodeURIComponent(settings.customSoundPath)}${revision}`)
        audio.volume = level
        const started = audio.play()
        if (started !== undefined && typeof started.catch === 'function') {
          started.catch((error) => {
            console.warn('[notify-sound] the custom sound could not be played, using the built-in chime instead:', error)
            const engine = audioEngine()
            if (engine !== undefined) BUILT_IN_SOUNDS.chime(engine, level)
          })
        }
        return true
      } catch (error) {
        console.warn('[notify-sound] the custom sound could not be created:', error)
        return false
      }
    }

    /**
     * Play the sound these settings select.
     *
     * The page has no volume control, so every sound plays at full level; the
     * built-in tones keep their own internal balance through that factor.
     * @param settings - current settings.
     */
    function playSound(settings) {
      const level = PLAYBACK_LEVEL
      if (settings.soundSource === 'custom' && settings.customSoundPath !== '' && playCustomSound(settings, level)) return
      const engine = audioEngine()
      if (engine === undefined) return
      const play = BUILT_IN_SOUNDS[settings.soundSource] ?? BUILT_IN_SOUNDS.chime
      try {
        play(engine, level)
      } catch (error) {
        console.warn('[notify-sound] the built-in sound could not be played:', error)
      }
    }

    // --- System notification ---------------------------------------------

    /**
     * Raise a Windows system notification. The prompt is requested on the first
     * notice, which is the earliest moment this plugin has something to show.
     * @param title - notification title.
     * @param body - notification body.
     */
    function systemNotify(title, body) {
      try {
        const Api = window.Notification
        if (typeof Api !== 'function') return
        if (Api.permission === 'granted') {
          new Api(title, { body, silent: true, tag: 'dsh-notify-sound' })
          return
        }
        if (Api.permission !== 'default') return
        const requested = Api.requestPermission()
        if (requested === undefined || typeof requested.then !== 'function') return
        requested.then((permission) => {
          if (permission === 'granted') new Api(title, { body, silent: true, tag: 'dsh-notify-sound' })
        }).catch(() => {})
      } catch (error) {
        console.warn('[notify-sound] the system notification is unavailable:', error)
      }
    }

    /**
     * Whether the page is in front of the user right now.
     * @returns true while the tab is visible and focused.
     */
    function pageIsFocused() {
      try {
        return document.visibilityState === 'visible' && document.hasFocus()
      } catch {
        return false
      }
    }

    // --- Formatting -------------------------------------------------------

    /**
     * Resolve one localized string out of a Host-provided map.
     * @param map - locale map such as `{ en, zh }`, possibly absent.
     * @param active - the active locale id.
     * @returns the first available string, or undefined.
     */
    function pickLocaleText(map, active) {
      if (map === null || typeof map !== 'object') return undefined
      const base = typeof active === 'string' ? active.split('-')[0] : ''
      for (const key of [active, base, 'en', '']) {
        if (typeof key !== 'string') continue
        const value = map[key]
        if (typeof value === 'string' && value !== '') return value
      }
      return undefined
    }

    /**
     * Title and body for one notice, in the active locale.
     * @param notice - notice from the Host.
     * @param t - bound translator.
     * @param active - the active locale id.
     * @returns the formatted pair.
     */
    function noticeText(notice, t, active) {
      if (notice.kind === 'turn-end') {
        return { title: t('notice.turnEnd.title'), body: t('notice.turnEnd.body') }
      }
      if (notice.kind === 'approval') {
        const reason = pickLocaleText(notice.displayReason, active)
          ?? (typeof notice.reason === 'string' && notice.reason !== '' ? notice.reason : undefined)
        return {
          title: t('notice.approval.title'),
          body: reason ?? (typeof notice.tool === 'string' && notice.tool !== '' ? notice.tool : t('notice.approval.body')),
        }
      }
      return {
        title: t('notice.question.title'),
        body: typeof notice.body === 'string' && notice.body !== '' ? notice.body : t('notice.question.body'),
      }
    }

    // --- Rendering --------------------------------------------------------

    /**
     * Subscribe one component to the store.
     * @param target - the store.
     * @returns the current state.
     */
    function useSnapshot(target) {
      const [snapshot, setSnapshot] = React.useState(target.getSnapshot)
      React.useEffect(() => target.subscribe(() => {
        setSnapshot(target.getSnapshot())
      }), [target])
      return snapshot
    }

    /**
     * One notification card, dismissed by its own timer or its close button.
     * @param props - notice, settings, store and translator.
     * @returns the card element.
     */
    function NoticeCard(props) {
      const { notice, settings, target, t } = props
      const duration = Math.max(1000, Math.round(settings.toastDurationMs))
      React.useEffect(() => {
        const timer = window.setTimeout(() => {
          target.dismiss(notice.id)
        }, duration)
        return () => {
          window.clearTimeout(timer)
        }
      }, [notice.id, duration, target])
      const text = noticeText(notice, t, props.active)
      const dismissLabel = t('notice.dismiss')
      return h('div', { className: 'dsh-ns-card', role: 'status', 'data-kind': notice.kind },
        h('div', { className: 'dsh-ns-accent', 'aria-hidden': 'true' }),
        h('div', { className: 'dsh-ns-body' },
          h('div', { className: 'dsh-ns-title' }, text.title),
          h('div', { className: 'dsh-ns-text' }, text.body),
          typeof notice.project === 'string' && notice.project !== ''
            ? h('div', { className: 'dsh-ns-meta' }, notice.project)
            : null,
        ),
        h('button', {
          type: 'button',
          className: 'dsh-ns-close',
          title: dismissLabel,
          'aria-label': dismissLabel,
          onClick: () => {
            target.dismiss(notice.id)
          },
        }, '\u00d7'),
      )
    }

    /**
     * Keeps one unrenderable contribution from blanking its whole slot entry: an
     * entry that throws is removed from its slot, so each card carries its own
     * boundary and a failure costs only that card for one render pass. A notice
     * card's boundary is keyed by notice id, so a later notice is a fresh
     * attempt instead of a permanently failed one.
     */
    class SafeBoundary extends React.Component {
      /** @param props - React props carrying the card element. */
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }

      /** @returns the state React uses after a descendant render error. */
      static getDerivedStateFromError() {
        return { failed: true }
      }

      /** @param error - the render error React caught. */
      componentDidCatch(error) {
        console.warn('[notify-sound] a notification card failed to render:', error)
      }

      /** @returns the card, or nothing once it has failed. */
      render() {
        return this.state.failed ? null : this.props.children
      }
    }

    /**
     * The frame-wide overlay entry: the whole stack, or nothing.
     * @returns the stack element, or null while there is nothing to show.
     */
    function NotifySoundHost() {
      const snapshot = useSnapshot(store)
      const settings = snapshot.settings
      const notices = snapshot.notices
      const styles = h('style', { key: 'styles' }, STYLES)
      if (notices.length === 0) return null
      const active = activeLocale()
      return h('div', { className: 'dsh-ns-stack' },
        styles,
        notices.map((notice) => h(SafeBoundary, { key: notice.id },
          h(NoticeCard, {
            notice,
            settings,
            target: store,
            t: translate,
            active,
          }),
        )),
      )
    }

    /** Active locale id, read fresh on every render so a switch repaints. */
    let localeService

    /**
     * @returns the active locale id, or an empty string before the service is read.
     */
    function activeLocale() {
      try {
        return localeService?.getLocale?.().active ?? ''
      } catch {
        return ''
      }
    }

    // --- Settings card ----------------------------------------------------

    /**
     * Subscribe one component to the notification store, which the Host's
     * settings frames also feed; the configuration page and the toast stack
     * therefore read one shared state.
     * @returns the current store state.
     */
    function useStoreSnapshot() {
      return useSnapshot(store)
    }

    /**
     * One settings row: its label, whether the user overrides it, the control,
     * and the per-field way back to the default.
     * @param props - field spec, current value, t, and the two handlers.
     * @returns the row element.
     */
    function SettingsField(props) {
      const { spec, value, overridden, staged, disabled, t, onChange, onReset } = props
      const label = t(`field.${spec.field}`)
      /** A transient message under the control, as a dictionary key. */
      const [note, setNote] = React.useState(undefined)

      /**
       * Fill this field from the machine's own file chooser.
       *
       * The Host answers `available: false` when the chooser would open on some
       * other machine than the one this page is on; only then does the page use
       * the browser's own picker and copy the bytes over, because a browser
       * cannot read a local path.
       */
      const browseForSound = () => {
        setNote('settings.picking')
        const chooseInBrowser = () => {
          const chooser = document.createElement('input')
          chooser.type = 'file'
          chooser.accept = AUDIO_EXTENSIONS.join(',')
          chooser.addEventListener('change', () => {
            const file = chooser.files?.[0]
            if (file === undefined) {
              setNote(undefined)
              return
            }
            setNote('settings.uploading')
            uploadSound(file, (stored) => {
              if (stored === undefined) {
                setNote('settings.uploadFailed')
                report('upload-failed', { name: file.name })
                return
              }
              setNote(undefined)
              onChange(stored)
            })
          }, { once: true })
          chooser.click()
        }
        pickFileOnHost((path) => {
          if (path === undefined) {
            chooseInBrowser()
            return
          }
          // A cancelled chooser and a chosen file both clear the waiting note.
          setNote(undefined)
          if (path !== null) onChange(path)
        })
      }

      let control
      if (spec.kind === 'switch') {
        control = h('button', {
          type: 'button',
          className: 'dsh-ns-switch',
          role: 'switch',
          'aria-checked': value === true,
          'aria-label': label,
          disabled,
          onClick: () => onChange(value !== true),
        })
      } else if (spec.kind === 'select') {
        control = h('select', {
          className: 'dsh-ns-input',
          value: typeof value === 'string' ? value : spec.options[0],
          'aria-label': label,
          disabled,
          onChange: (event) => onChange(event.target.value),
        }, spec.options.map((option) => h('option', { key: option, value: option }, t(`option.${option}`))))
      } else if (spec.kind === 'range') {
        control = h('input', {
          type: 'range',
          className: 'dsh-ns-input dsh-ns-range',
          min: spec.min,
          max: spec.max,
          step: spec.step,
          value: typeof value === 'number' ? value : spec.min,
          'aria-label': label,
          disabled,
          onChange: (event) => onChange(Number(event.target.value)),
        })
      } else if (spec.kind === 'number') {
        control = h('input', {
          type: 'number',
          className: 'dsh-ns-input',
          min: spec.min,
          max: spec.max,
          step: spec.step,
          value: typeof value === 'number' ? String(value) : '',
          'aria-label': label,
          disabled,
          onChange: (event) => {
            const parsed = Number(event.target.value)
            if (Number.isFinite(parsed)) onChange(parsed)
          },
        })
      } else if (spec.kind === 'path') {
        // The value stays editable by hand; Browse hands the job to this
        // machine's own chooser, and only a browser that cannot reach that
        // machine falls back to picking a file to copy in.
        control = h('div', { className: 'dsh-ns-path' },
          h('input', {
            type: 'text',
            className: 'dsh-ns-input',
            value: typeof value === 'string' ? value : '',
            'aria-label': label,
            spellCheck: false,
            disabled,
            onChange: (event) => onChange(event.target.value),
          }),
          h('button', {
            type: 'button',
            className: 'dsh-ns-btn',
            disabled,
            onClick: browseForSound,
          }, t('settings.browse')),
        )
      } else {
        control = h('input', {
          type: 'text',
          className: 'dsh-ns-input',
          value: typeof value === 'string' ? value : '',
          'aria-label': label,
          spellCheck: false,
          disabled,
          onChange: (event) => onChange(event.target.value),
        })
      }
      return h('div', { className: 'dsh-ns-field' },
        h('div', { className: 'dsh-ns-field-head' },
          h('span', { className: 'dsh-ns-field-label' }, label),
          staged === true ? h('span', { className: 'dsh-ns-badge' }, t('settings.staged')) : null,
          overridden ? h('span', { className: 'dsh-ns-badge' }, t('settings.overridden')) : null,
          overridden
            ? h('button', {
              type: 'button',
              className: 'dsh-ns-reset',
              disabled,
              onClick: onReset,
            }, t('settings.reset'))
            : null,
        ),
        control,
        note === undefined ? null : h('p', { className: 'dsh-ns-note' }, t(note)),
        spec.hint === true ? h('p', { className: 'dsh-ns-field-hint' }, t(`field.${spec.field}.hint`)) : null,
      )
    }

    /**
     * The plugin's configuration card, shown in Settings → Plugins. Edits are
     * staged locally and written on save, one field at a time, so a rejected
     * value leaves the stored settings untouched.
     * @returns the card element.
     */
    function SettingsCard() {
      const state = useStoreSnapshot()
      const [draft, setDraft] = React.useState({})
      const [saving, setSaving] = React.useState(false)
      const [failed, setFailed] = React.useState(false)
      const t = translate
      const styles = h('style', { key: 'styles' }, SETTINGS_STYLES)
      // The Host's first frame carries the effective settings; until it arrives
      // the tab explains itself instead of showing an empty panel.
      if (!state.received) {
        return h(SafeBoundary, null, h('section', { className: 'dsh-ns-panel' },
          styles,
          h('div', { className: 'dsh-ns-panel-head' },
            h('div', { className: 'dsh-ns-panel-title' }, t('settings.title')),
          ),
          h('p', { className: 'dsh-ns-note' }, t('settings.loading')),
        ))
      }
      const effective = state.settings
      const stored = state.overrides
      const dirty = Object.keys(draft).length > 0

      /**
       * Send one patch, then drop the staged edits it covered.
       * @param patch - partial update; `null` clears that override.
       * @param staged - field names the patch resolves.
       */
      const write = (patch, staged) => {
        if (saving) return
        setSaving(true)
        setFailed(false)
        saveSettingsPatch(patch, (ok) => {
          setSaving(false)
          if (!ok) {
            setFailed(true)
            report('settings-save-failed', { fields: staged })
            return
          }
          setDraft((previous) => {
            const next = { ...previous }
            for (const field of staged) delete next[field]
            return next
          })
        })
      }

      return h(SafeBoundary, null, h('section', { className: 'dsh-ns-panel' },
        styles,
        h('div', { className: 'dsh-ns-panel-head' },
          h('div', null,
            h('div', { className: 'dsh-ns-panel-title' }, t('settings.title')),
            h('p', { className: 'dsh-ns-panel-intro' }, t('settings.intro')),
          ),
          h('div', { className: 'dsh-ns-panel-actions' },
            dirty
              ? h('button', {
                type: 'button',
                className: 'dsh-ns-btn',
                disabled: saving,
                onClick: () => {
                  setDraft({})
                },
              }, t('settings.discard'))
              : null,
            dirty
              ? h('button', {
                type: 'button',
                className: 'dsh-ns-btn dsh-ns-btn-primary',
                disabled: saving,
                onClick: () => {
                  write({ ...draft }, Object.keys(draft))
                },
              }, saving ? t('settings.saving') : t('settings.save'))
              : null,
            Object.keys(stored).length > 0
              ? h('button', {
                type: 'button',
                className: 'dsh-ns-btn',
                disabled: saving,
                onClick: () => {
                  const fields = Object.keys(stored)
                  write(Object.fromEntries(fields.map((field) => [field, null])), fields)
                },
              }, t('settings.resetAll'))
              : null,
          ),
        ),
        failed ? h('p', { className: 'dsh-ns-note dsh-ns-note-error' }, t('settings.saveFailed')) : null,
        SETTINGS_FIELDS.map((spec) => [
          spec.group === undefined ? null : h('p', { key: `group-${spec.field}`, className: 'dsh-ns-group' }, t(spec.group)),
          h(SettingsField, {
            key: spec.field,
            spec,
            value: spec.field in draft ? draft[spec.field] : effective[spec.field],
            overridden: stored[spec.field] !== undefined,
            staged: spec.field in draft,
            disabled: saving,
            t,
            onChange: (next) => {
              setDraft((previous) => ({ ...previous, [spec.field]: next }))
            },
            onReset: () => {
              write({ [spec.field]: null }, [spec.field])
            },
          }),
        ]),
      ))
    }

    // --- Transport --------------------------------------------------------

    /**
     * Handle one frame from the Host.
     * @param ctx - plugin context.
     * @param data - raw frame payload.
     */
    function handleFrame(ctx, data) {
      let frame
      try {
        frame = JSON.parse(data)
      } catch {
        return
      }
      if (frame === null || typeof frame !== 'object') return
      if (frame.type === 'hello' || frame.type === 'settings') {
        store.setSettings(normalizeSettings(frame.settings), frame.overrides, frame.soundRevision)
        soundRevision = typeof frame.soundRevision === 'string' ? frame.soundRevision : soundRevision
        return
      }
      if (frame.type !== 'notice') return
      const notice = frame.notice
      if (notice === null || typeof notice !== 'object' || typeof notice.kind !== 'string') return
      const settings = store.getSnapshot().settings
      if (settings.notify === false) return
      if (settings.onlyWhenUnfocused && pageIsFocused()) return
      const text = noticeText(notice, translate, activeLocale())
      if (settings.sound) playSound(settings)
      systemNotify(text.title, text.body)
      store.push(notice)
    }

    /** Services this plugin needs before it may activate. */
    const inject = ['slots', 'locale']

    /**
     * Register the dictionaries, the overlay entry, the settings page, and the
     * Host push channel.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      report('apply', { tabDeclared: String(ctx.slots.spec?.('settings.plugins.tab') !== undefined) })
      localeService = ctx.locale
      ctx.effect(() => ctx.locale.register(NS, DICTIONARIES), 'notify-sound: dictionaries')
      translate = ctx.locale.bind(NS)

      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'notify-sound.toasts',
        order: 500,
      }, NotifySoundHost))

      // The configuration page lives in Settings → Plugins, where the section
      // owner mounts each contribution inside its own tab panel. It reads and
      // writes through this plugin's own routes, so it needs no platform
      // settings service to exist.
      ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
        name: 'settings.plugins.tab',
        id: SETTINGS_NS,
        order: 5,
        label: () => translate('settings.tabLabel'),
      }, SettingsCard))

      ctx.effect(() => {
        let source
        const open = () => {
          if (source !== undefined) source.close()
          source = new EventSource(EVENTS_ROUTE)
          source.addEventListener('message', (event) => {
            handleFrame(ctx, event.data)
          })
          // EventSource reconnects by itself; the Host's `hello` on the next
          // connection is what republishes the settings.
        }
        open()
        const disposeReset = ctx.on('connection/reset', open)
        return () => {
          disposeReset()
          if (source !== undefined) source.close()
          source = undefined
        }
      }, 'notify-sound: host channel')
    }

    return { name: 'notify-sound', inject, apply }
  },
})