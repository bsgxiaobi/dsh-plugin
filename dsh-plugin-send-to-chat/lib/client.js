/**
 * `dsh-plugin-send-to-chat` — browser half.
 *
 * Adds a "send to chat" action to the two places where a user is looking at a
 * file and would otherwise retype a path:
 *
 *   1. A right-click on a row of the sidebar's Workspace Files tree sends the
 *      file or folder as an `@path` reference — a real reference chip, the same
 *      one an `@` menu pick inserts.
 *   2. A right-click on a multi-line selection in a text/code preview sends the
 *      selected line range as `@path#n-m` literal text.
 *
 * Why the DOM: the shipped files tree deliberately ships no context menu (its
 * README lists "context menu" under Known Limitations) and offers no Slot for
 * row actions, and the document preview exposes no per-selection seam. Every
 * keyed Slot has exactly one occupant, so a plugin cannot wrap either body. The
 * tree and the previews do publish stable `data-*` anchors for their rows,
 * lines, and addresses, and this plugin reads only those — it never writes to
 * the DOM of the surfaces it decorates.
 *
 * Why the `conversation` service: `ctx.get('conversation').input.shell(id)` is
 * the Session input shell. `actions.captureInsertion()` plus
 * `actions.insertText(text, span)` is the documented composer insertion seam,
 * and `shell.insertReference(ref, span)` is exactly what the `@` menu pick
 * calls.
 */

window.__ModuleLoader__.load({
	id: 'dsh-plugin-send-to-chat',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		const React = require('react');
		const { Menu } = require('@deepseek-ai/dsh-client-ui-primitives');

		/** Locale namespace owned by this plugin. */
		const NS = 'sendToChat';

		/** Stylesheet identity used to keep the insertion idempotent across reloads. */
		const CSS_TAG_ID = 'dsh-plugin-send-to-chat/menu.css';

		/** The client context, captured in `apply` for the module-scoped fallback path. */
		let pluginCtx = null;

		//#region selectors — the shipped UI's stable anchors
		/**
		 * One row of the Workspace Files tree. The header's `PathLabel` also
		 * carries a `data-files-path` attribute, so both the `li` and the entry
		 * kind are required to keep that header out of the match.
		 */
		const TREE_ROW = 'li[data-files-entry][data-files-path]';
		/** The preview body of a loaded, text-compatible document. */
		const TEXT_PREVIEW = '[data-textpreview-state="text"]';
		/** One numbered source line of the plain-text renderer. */
		const PLAIN_LINE = '[data-textpreview-plain] [data-textpreview-line]';
		/** One source line of the code renderer; its number is its 1-based index. */
		const CODE_LINE = '[data-code-preview] .line';
		/** The Lexical contenteditable root of a composer. */
		const COMPOSER = '[data-composer-input]';
		/** The conversation body naming the Session its composer writes to. */
		const SESSION_OWNER = '[data-conversation-session]';
		/** The workspace root the tree is rooted at (the Session working directory). */
		const TREE_ROOT = '[data-files-root]';
		/** The resource address of the previewed file. */
		const PREVIEW_URL = '[data-textpreview-url]';
		/** The previewed file's displayed path. */
		const PREVIEW_PATH = '[data-textpreview-path]';
		//#endregion

		//#region locales
		/** Simplified Chinese dictionary. */
		const zh = {
			'action.send': '发送到对话框',
			'action.sendLine': '发送到对话框（第 {line} 行）',
			'action.sendRange': '发送到对话框（第 {from}-{to} 行）',
			'action.unavailable': '当前没有可用的输入框'
		};

		/** English dictionary with the same keys. */
		const en = {
			'action.send': 'Send to chat',
			'action.sendLine': 'Send to chat (line {line})',
			'action.sendRange': 'Send to chat (lines {from}-{to})',
			'action.unavailable': 'No composer is available'
		};
		//#endregion

		//#region styles
		const CSS = [
			'.dsh-stc-anchor{position:fixed;width:1px;height:1px;pointer-events:none}',
			'.dsh-stc-label{display:flex;flex-direction:column;gap:1px;min-width:0;text-align:start}',
			'.dsh-stc-title{color:var(--dsw-alias-label-primary)}',
			'.dsh-stc-ref{font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:11px;line-height:1.4;color:var(--dsw-alias-label-secondary);max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
		].join('');

		/** Insert this plugin's stylesheet once per page. */
		function installStyles() {
			if (typeof document === 'undefined') return;
			if (document.querySelector(`style[data-plugin-css=${JSON.stringify(CSS_TAG_ID)}]`) !== null) return;
			const tag = document.createElement('style');
			tag.dataset.plugin = 'dsh-plugin-send-to-chat';
			tag.dataset.pluginCss = CSS_TAG_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region path helpers
		/** Normalize a Host path to `/` separators for comparison and display. */
		function toSlashes(value) {
			return String(value).replace(/\\/gu, '/');
		}

		/** Whether a path is absolute in either spelling the Host accepts. */
		function isAbsolutePath(value) {
			return /^[A-Za-z]:[/\\]/u.test(value) || value.startsWith('\\\\') || value.startsWith('/');
		}

		/**
		 * Express an absolute path relative to a workspace root, falling back to
		 * the absolute path when it lies outside that root. The model resolves
		 * relative `@` tokens from the workspace root.
		 * @param absolutePath - the file or folder path.
		 * @param root - the workspace root, when known.
		 * @returns the workspace-relative path, or the absolute path.
		 */
		function workspaceRelative(absolutePath, root) {
			const path = toSlashes(absolutePath);
			if (root === undefined || root === null || root === '') return path;
			let prefix = toSlashes(root);
			if (!prefix.endsWith('/')) prefix += '/';
			if (path.toLowerCase().startsWith(prefix.toLowerCase())) return path.slice(prefix.length);
			if (`${path}/`.toLowerCase() === prefix.toLowerCase()) return '';
			return path;
		}

		/**
		 * Join a workspace root and a relative path using the root's own separator.
		 * @param root - the workspace root.
		 * @param relative - the workspace-relative path.
		 * @returns the joined path.
		 */
		function joinPath(root, relative) {
			const separator = toSlashes(root) === String(root) ? '/' : '\\';
			return `${String(root).replace(/[/\\]+$/u, '')}${separator}${relative.replace(/^[/\\]+/u, '')}`;
		}

		/**
		 * Format one path as an `@` reference token following the shared `@file`
		 * grammar: a bare `@path`, a quoted `@"path"` when it contains
		 * whitespace, and a trailing `/` for folders.
		 * @param path - the workspace-relative or absolute path.
		 * @param directory - whether the target is a folder.
		 * @returns the mention text, or `undefined` for a path the grammar cannot represent.
		 */
		function formatMention(path, directory) {
			if (path === undefined || path === '') return undefined;
			let value = path;
			if (directory && !value.endsWith('/')) value += '/';
			// The grammar cannot represent control characters or an embedded quote.
			if (/[\u0000-\u001f\u007f-\u009f"]/u.test(value)) return undefined;
			if (/\s/u.test(value)) return `@"${value}"`;
			return `@${value}`;
		}

		/**
		 * Annotate one file mention with a selected line range.
		 * @param mention - the file's `@` mention.
		 * @param from - first selected line, 1-based.
		 * @param to - last selected line, 1-based.
		 * @returns `@path#n` or `@path#n-m`.
		 */
		function formatRange(mention, from, to) {
			return from === to ? `${mention}#${from}` : `${mention}#${from}-${to}`;
		}
		//#endregion

		//#region resource addresses
		const FILE_ADDRESS_PREFIX = 'dsh-resource://file/';

		/**
		 * Read a `dsh-resource://file/…` address into its scope and path without
		 * resolving `.` or `..`. Mirrors the browser-safe parser in
		 * `@deepseek-ai/dsh-util-workspace-path`, which is not a plugin baseline
		 * module and therefore cannot be required from this bundle.
		 * @param address - a candidate address.
		 * @returns the parts, or `undefined` when the address is not a file address.
		 */
		function parseFileAddress(address) {
			if (typeof address !== 'string' || !address.startsWith(FILE_ADDRESS_PREFIX)) return undefined;
			try {
				const end = address.search(/[?#]/u);
				const parts = address.slice(FILE_ADDRESS_PREFIX.length, end === -1 ? undefined : end).split('/');
				const scope = parts.shift();
				if (scope === 'session') {
					const id = parts.shift();
					if (id === undefined || id === '' || parts.length === 0) return undefined;
					return {
						scope,
						// A session address carries a workspace-relative path.
						sessionId: decodeURIComponent(id),
						path: parts.map(decodeURIComponent).join('/'),
						absolute: false
					};
				}
				if (scope === 'absolute') {
					const unc = parts[0] === '' && parts.length > 1;
					const segments = (unc ? parts.slice(1) : parts).map(decodeURIComponent);
					if (segments.length === 0 || segments[0] === '') return undefined;
					return {
						scope,
						sessionId: undefined,
						path: unc ? `//${segments.join('/')}` : segments.join('/'),
						absolute: true
					};
				}
				return undefined;
			} catch {
				return undefined;
			}
		}
		//#endregion

		//#region selection → line range
		/**
		 * The line elements of one preview body, paired with their 1-based number.
		 * The plain-text renderer numbers each line explicitly; the code renderer
		 * numbers by source order.
		 * @param preview - the preview body element.
		 * @returns the line elements in source order.
		 */
		function lineElements(preview) {
			const plain = Array.from(preview.querySelectorAll(PLAIN_LINE));
			if (plain.length > 0) {
				return plain.map((element) => ({
					element,
					number: Number(element.getAttribute('data-textpreview-line'))
				}));
			}
			return Array.from(preview.querySelectorAll(CODE_LINE)).map((element, index) => ({
				element,
				number: index + 1
			}));
		}

		/**
		 * Map the current document selection onto a 1-based line range inside one
		 * preview. A selection ending exactly where a line begins does not include
		 * that line, and `Range.intersectsNode` already reports that: a boundary
		 * coinciding with a node's start is not an intersection.
		 * @param preview - the preview body element.
		 * @returns the selected range, or `undefined` without a usable selection.
		 */
		function selectedLineRange(preview) {
			const selection = window.getSelection();
			if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return undefined;
			const range = selection.getRangeAt(0);
			if (!preview.contains(range.commonAncestorContainer)) return undefined;
			const lines = lineElements(preview).filter((line) => range.intersectsNode(line.element));
			if (lines.length === 0) return undefined;
			const numbers = lines.map((line) => line.number).filter((number) => Number.isFinite(number) && number > 0);
			if (numbers.length === 0) return undefined;
			return { from: Math.min(...numbers), to: Math.max(...numbers) };
		}
		//#endregion

		//#region menu store
		/**
		 * The open context-menu request, or null. The menu host is a root-scoped
		 * overlay entry, so the open state lives outside React and is published
		 * through a minimal external store.
		 */
		let menuRequest = null;
		const menuListeners = new Set();

		/** Publish the next menu request. @param next - the request, or null to close. */
		function setMenuRequest(next) {
			if (menuRequest === next) return;
			menuRequest = next;
			for (const listener of Array.from(menuListeners)) listener();
		}

		/** Subscribe to menu-request changes. @param listener - change callback. @returns the unsubscribe. */
		function subscribeMenu(listener) {
			menuListeners.add(listener);
			return () => {
				menuListeners.delete(listener);
			};
		}

		/** Read the current menu request as a React snapshot. @returns the request or null. */
		function getMenuRequest() {
			return menuRequest;
		}
		//#endregion

		//#region composer targeting
		/**
		 * Every mounted, editable composer root in document order.
		 * @returns the composer root elements.
		 */
		function composerRoots() {
			return Array.from(document.querySelectorAll(COMPOSER)).filter((element) => element.isContentEditable);
		}

		/**
		 * The composer an insertion should target: the one holding the keyboard,
		 * else the largest visible one (the main conversation outgrows a docked
		 * Sidebar chat), else the last mounted one.
		 * @returns the target composer root, or `undefined`.
		 */
		function activeComposer() {
			const roots = composerRoots();
			if (roots.length === 0) return undefined;
			const active = document.activeElement;
			if (active !== null && active !== undefined) {
				for (const root of roots) {
					if (root === active || root.contains(active)) return root;
				}
			}
			const visible = roots.filter((root) => root.getClientRects().length > 0);
			if (visible.length === 0) return roots[roots.length - 1];
			let best = visible[0];
			let bestArea = -1;
			for (const root of visible) {
				const rect = root.getBoundingClientRect();
				const area = rect.width * rect.height;
				if (area > bestArea) {
					bestArea = area;
					best = root;
				}
			}
			return best;
		}

		/**
		 * The Session a composer writes to.
		 * @param composer - the composer root.
		 * @returns the Session id, or `undefined`.
		 */
		function sessionIdOf(composer) {
			const owner = composer.closest(SESSION_OWNER);
			const value = owner === null ? null : owner.getAttribute('data-conversation-session');
			return value === null || value === undefined || value === '' ? undefined : value;
		}

		/**
		 * Resolve the Session input shell for the composer an insertion targets.
		 * `hub.shell(id)` also guarantees the Session's input events are wired,
		 * and throws for a Session that is not retained.
		 * @param ctx - client plugin context.
		 * @returns the shell and its composer, or `undefined`.
		 */
		function targetShell(ctx) {
			const composer = activeComposer();
			if (composer === undefined) return undefined;
			const sessionId = sessionIdOf(composer);
			if (sessionId === undefined) return undefined;
			const conversation = ctx.get('conversation');
			if (conversation === undefined || conversation.input === undefined) return undefined;
			try {
				return { shell: conversation.input.shell(sessionId), composer };
			} catch {
				return undefined;
			}
		}
		//#endregion

		//#region insertion
		/**
		 * Deliver one menu pick: capture the caret, focus the target composer, then
		 * insert. The caret is captured first because focusing can re-derive the
		 * DOM selection, while the detect offsets and the draft revision stay
		 * stable.
		 * @param ctx - client plugin context.
		 * @param request - the picked request.
		 * @returns whether the editor applied an insertion.
		 */
		function applyPick(ctx, request) {
			const target = targetShell(ctx);
			if (target === undefined) return false;
			const { shell, composer } = target;
			const span = shell.actions.captureInsertion();
			if (document.activeElement !== composer) composer.focus();
			if (request.kind === 'range') return shell.actions.insertText(`${request.text} `, span);

			const mention = request.mention;
			// The mention already carries a folder's trailing slash, so it is also
			// the label; the chip's own glyph distinguishes the two kinds.
			const applied = shell.insertReference(
				{
					source: 'reference',
					ref: mention,
					label: mention,
					appearance: request.directory ? 'folder' : 'file',
					clipboardText: mention
				},
				span
			);
			if (applied) return true;
			// A locked submit phase, a stale revision, or an unmounted reference
			// source: fall back to the literal token so the gesture still lands.
			return shell.actions.insertText(`${mention} `, span);
		}
		//#endregion

		//#region request building
		/**
		 * The viewport point a context menu should open at.
		 * @param event - the contextmenu event.
		 * @returns viewport coordinates.
		 */
		function pointOf(event) {
			return { x: event.clientX, y: event.clientY };
		}

		/**
		 * The working directory of the Session a preview's file belongs to. Used to
		 * relativize the same way the model will resolve the token.
		 * @param preview - the preview body element.
		 * @param ctx - client plugin context.
		 * @returns the working directory, or `undefined`.
		 */
		function previewCwd(preview, ctx) {
			const address = parseFileAddress(preview.getAttribute(PREVIEW_URL) ?? '');
			if (address === undefined || address.sessionId === undefined) return undefined;
			const sessions = ctx.get('sessions');
			const row = sessions?.list?.getSnapshot?.().byId?.[address.sessionId];
			return row === undefined || row.cwd === undefined || row.cwd === null ? undefined : row.cwd;
		}

		/**
		 * The absolute path of the previewed file. The header shows the Host path
		 * when one is known; a session-scoped address otherwise carries the
		 * workspace-relative path, which is resolved against the Session cwd.
		 * @param preview - the preview body element.
		 * @param ctx - client plugin context.
		 * @returns the absolute path, or `undefined`.
		 */
		function previewAbsolutePath(preview, ctx) {
			const shown = preview.querySelector(PREVIEW_PATH)?.textContent ?? '';
			const address = parseFileAddress(preview.getAttribute(PREVIEW_URL) ?? '');
			if (address !== undefined && address.absolute) return address.path;
			if (isAbsolutePath(shown)) return shown;
			const cwd = previewCwd(preview, ctx);
			if (cwd !== undefined && shown !== '') return joinPath(cwd, shown);
			if (cwd !== undefined && address !== undefined) return joinPath(cwd, address.path);
			if (shown !== '') return shown;
			return address?.path;
		}

		/**
		 * Build the menu request for one contextmenu event.
		 * @param ctx - client plugin context.
		 * @param event - the contextmenu event.
		 * @param t - locale translate function.
		 * @returns the request, or `undefined` when the event did not land on a supported target.
		 */
		function buildRequest(ctx, event, t) {
			const target = event.target;
			if (!(target instanceof Element)) return undefined;

			const row = target.closest(TREE_ROW);
			if (row !== null) {
				const absolute = row.getAttribute('data-files-path');
				const kind = row.getAttribute('data-files-entry');
				if (absolute !== null && (kind === 'file' || kind === 'directory')) {
					const directory = kind === 'directory';
					const root = row.closest(TREE_ROOT)?.getAttribute('data-files-root') ?? undefined;
					const mention = formatMention(workspaceRelative(absolute, root), directory);
					if (mention !== undefined) {
						return {
							kind: 'path',
							point: pointOf(event),
							mention,
							directory,
							label: t('action.send')
						};
					}
				}
			}

			const preview = target.closest(TEXT_PREVIEW);
			if (preview !== null) {
				const lines = selectedLineRange(preview);
				if (lines !== undefined) {
					const absolute = previewAbsolutePath(preview, ctx);
					const mention = formatMention(workspaceRelative(absolute, previewCwd(preview, ctx)), false);
					if (mention !== undefined) {
						const text = formatRange(mention, lines.from, lines.to);
						return {
							kind: 'range',
							point: pointOf(event),
							mention,
							text,
							directory: false,
							label:
								lines.from === lines.to
									? t('action.sendLine', { line: lines.from })
									: t('action.sendRange', { from: lines.from, to: lines.to })
						};
					}
				}
			}

			return undefined;
		}
		//#endregion

		//#region components
		/**
		 * The context menu, mounted once into the frame-wide overlay.
		 * @param props - composed slot props (`t` comes from the declared locale namespace).
		 * @returns the menu, or null while closed.
		 */
		function SendToChatMenu(props) {
			const request = React.useSyncExternalStore(subscribeMenu, getMenuRequest, getMenuRequest);
			const anchorRef = React.useRef(null);
			const t = props.t;

			React.useEffect(() => {
				if (request === null) return undefined;
				const close = () => {
					setMenuRequest(null);
				};
				const onPointerDown = (event) => {
					const target = event.target;
					// Rows pick on click, so only presses outside the portalled list close it.
					if (target instanceof Element && target.closest('[role="menu"], .dsh-stc-anchor') !== null) return;
					close();
				};
				const onKeyDown = (event) => {
					if (event.key === 'Escape') close();
				};
				document.addEventListener('mousedown', onPointerDown, true);
				document.addEventListener('keydown', onKeyDown, true);
				window.addEventListener('blur', close);
				window.addEventListener('resize', close);
				window.addEventListener('scroll', close, true);
				return () => {
					document.removeEventListener('mousedown', onPointerDown, true);
					document.removeEventListener('keydown', onKeyDown, true);
					window.removeEventListener('blur', close);
					window.removeEventListener('resize', close);
					window.removeEventListener('scroll', close, true);
				};
			}, [request]);

			if (request === null) return null;

			const ref = request.text ?? request.mention;
			const label = React.createElement(
				'span',
				{ className: 'dsh-stc-label' },
				React.createElement('span', { className: 'dsh-stc-title' }, request.insertable ? request.label : t('action.unavailable')),
				React.createElement('span', { className: 'dsh-stc-ref', title: ref }, ref)
			);

			return React.createElement(Menu, {
				open: true,
				portal: true,
				autoFocus: true,
				compact: true,
				align: 'start',
				side: 'bottom',
				anchor: React.createElement('div', {
					ref: anchorRef,
					className: 'dsh-stc-anchor',
					style: { left: `${request.point.x}px`, top: `${request.point.y}px` }
				}),
				getAnchorRect: () => (anchorRef.current === null ? null : anchorRef.current.getBoundingClientRect()),
				items: [{ id: 'send', label, disabled: request.insertable !== true }],
				onSelect: () => {
					const picked = request;
					setMenuRequest(null);
					// Defer past the menu's own teardown so the composer keeps the keyboard.
					queueMicrotask(() => {
						if (pluginCtx !== null && !applyPick(pluginCtx, picked)) {
							console.warn('[send-to-chat] the composer refused the insertion');
						}
					});
				},
				onClose: () => setMenuRequest(null)
			});
		}
		//#endregion

		//#region plugin body
		/** Required client services: the slot registry, Sessions, dictionaries, and the input shell. */
		const inject = ['slots', 'sessions', 'locale', 'conversation'];

		/**
		 * Client plugin body: install the context-menu listener, the overlay menu,
		 * and this plugin's dictionaries.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			pluginCtx = ctx;
			installStyles();

			ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'send-to-chat: dictionaries');
			const t = ctx.locale.bind(NS);

			/**
			 * Offer the action only where the shipped UI has no context menu of its
			 * own, so a right-click anywhere else keeps its normal meaning.
			 */
			const onContextMenu = (event) => {
				let request;
				try {
					request = buildRequest(ctx, event, t);
				} catch (error) {
					console.error('[send-to-chat] failed to build the menu request:', error);
					return;
				}
				if (request === undefined) return;
				// Take the gesture: neither surface owns a menu, and the browser's
				// default menu has nothing to say about a file reference.
				event.preventDefault();
				event.stopPropagation();
				setMenuRequest({ ...request, insertable: activeComposer() !== undefined });
			};

			ctx.effect(() => {
				document.addEventListener('contextmenu', onContextMenu, true);
				return () => {
					document.removeEventListener('contextmenu', onContextMenu, true);
					setMenuRequest(null);
				};
			}, 'send-to-chat: context menu listener');

			ctx.slots.inject('shell.overlay', () =>
				ctx.slots.register(
					{
						name: 'shell.overlay',
						id: 'send-to-chat',
						order: 1000,
						locale: NS
					},
					SendToChatMenu
				)
			);
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
