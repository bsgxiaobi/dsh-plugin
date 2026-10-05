/**
 * Verify that DSH can read this plugin's localized display metadata, replicating
 * `readPluginMeta` from `@deepseek-ai/dsh-app-boot` against the real installed
 * profile. Read-only.
 *
 * Usage: node verify-meta.mjs [profileDir]
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const PACKAGE = 'dsh-plugin-send-to-chat';
const LANGUAGE_ID = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;
const MAX_ICON_BYTES = 256 * 1024;
const ICON_MEDIA_TYPES = new Map([
	['.svg', 'image/svg+xml'],
	['.png', 'image/png'],
	['.jpg', 'image/jpeg'],
	['.jpeg', 'image/jpeg'],
	['.webp', 'image/webp']
]);

const profileDir = process.argv[2] ?? path.join(process.env.DSH_HOME ?? '', 'profiles', process.env.DSH_PROFILE ?? 'desktop');

/** DSH resolves plugin resources through the owning Loader tree's base. */
const require_ = createRequire(path.join(profileDir, 'noop.js'));

/** Mirrors `optionalResourcePath`: missing export or file yields undefined. */
function optionalResourcePath(specifier) {
	try {
		return require_.resolve(specifier);
	} catch (error) {
		if (['ERR_PACKAGE_PATH_NOT_EXPORTED', 'MODULE_NOT_FOUND', 'ENOENT'].includes(error?.code)) return undefined;
		throw error;
	}
}

/** Mirrors `textOf`: undefined passes, anything else must be a non-empty string. */
function textOf(value, label) {
	if (value === undefined) return undefined;
	if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`);
	return value;
}

/** Mirrors `dictionariesOf` + `localizedText` for one field. */
function localizedText(field, dictionaries, fallback) {
	const entries = [...dictionaries].flatMap(([language, fields]) => {
		const value = fields[field];
		return value === undefined ? [] : [[language, value]];
	});
	if (entries.length === 0) return fallback;
	return { en: fallback ?? '', ...Object.fromEntries(entries) };
}

/** Mirrors the locale half of `readPluginMeta`. */
function readMeta() {
	const englishPath = optionalResourcePath(`${PACKAGE}/locale/en.json`);
	if (englishPath === undefined) {
		console.log('!! locale/en.json does NOT resolve — DSH would fall back to the raw package.json fields');
		return undefined;
	}
	console.log(`locale/en.json resolved -> ${englishPath}`);

	const englishDir = path.dirname(fs.realpathSync(englishPath));
	const dictionaries = new Map();
	for (const entry of fs.readdirSync(englishDir, { withFileTypes: true })) {
		if (!entry.name.endsWith('.json')) continue;
		const language = entry.name.slice(0, -5);
		if (!LANGUAGE_ID.test(language)) throw new Error(`locale/${entry.name} is not a language id`);
		const file = require_.resolve(`${PACKAGE}/locale/${entry.name}`);
		if (path.dirname(fs.realpathSync(file)) !== englishDir) throw new Error(`locale/${entry.name} is outside the English locale directory`);
		const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
		const meta = parsed.meta ?? {};
		dictionaries.set(language.toLowerCase(), {
			title: textOf(meta.title, `locale/${entry.name}: meta.title`),
			description: textOf(meta.description, `locale/${entry.name}: meta.description`)
		});
	}

	const manifestPath = optionalResourcePath(`${PACKAGE}/package.json`);
	const manifest = manifestPath === undefined ? {} : JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
	console.log(`package.json resolved -> ${manifestPath}`);

	return {
		title: localizedText('title', dictionaries, typeof manifest.name === 'string' ? manifest.name : PACKAGE),
		description: localizedText('description', dictionaries, typeof manifest.description === 'string' ? manifest.description : ''),
		dictionaries: [...dictionaries.keys()],
		icon: iconOf(manifest.icon, manifestPath)
	};
}

/** Mirrors `iconOf`: relative path, known media type, inside the manifest directory, a bounded regular file. */
function iconOf(value, manifestPath) {
	if (value === undefined) return { present: false, note: 'no "icon" field in package.json' };
	if (typeof value !== 'string' || value.trim() === '') throw new Error('icon must be a non-empty string');
	if (path.isAbsolute(value) || /^[A-Za-z][A-Za-z\d+.-]*:/u.test(value)) throw new Error('icon must be a relative file path');
	const mediaType = ICON_MEDIA_TYPES.get(path.extname(value).toLowerCase());
	if (mediaType === undefined) throw new Error('icon must be SVG, PNG, JPEG, or WebP');
	if (manifestPath === undefined) return { present: false, note: 'package.json did not resolve' };
	const directory = fs.realpathSync(path.dirname(manifestPath));
	const file = fs.realpathSync(path.resolve(directory, value));
	const local = path.relative(directory, file);
	if (local === '..' || local.startsWith(`..${path.sep}`) || path.isAbsolute(local)) throw new Error('icon must remain inside its manifest directory');
	const stat = fs.statSync(file);
	if (!stat.isFile()) throw new Error('icon must be a regular file');
	if (stat.size > MAX_ICON_BYTES) throw new Error(`icon exceeds 256 KiB (${stat.size} bytes)`);
	return { present: true, file, mediaType, bytes: stat.size, inlinedBytes: Math.ceil(stat.size / 3) * 4 };
}

console.log(`profile        : ${profileDir}`);
console.log(`package        : ${PACKAGE}`);
console.log('');

const meta = readMeta();
if (meta === undefined) process.exit(1);

console.log('');
console.log(`languages found: ${meta.dictionaries.join(', ')}`);
console.log('');
console.log('--- icon ---');
if (meta.icon.present) {
	console.log(`  ${meta.icon.file}`);
	console.log(`  media type ${meta.icon.mediaType}, ${meta.icon.bytes} bytes -> ~${meta.icon.inlinedBytes} bytes as a base64 data URL`);
} else {
	console.log(`  none (${meta.icon.note}) — the Plugins page draws its generic artwork`);
}
console.log('');
console.log('--- what the Plugins page receives ---');
console.log(JSON.stringify({ title: meta.title, description: meta.description, icon: meta.icon.present ? '(data URL)' : undefined }, null, 2));

/** What `ctx.locale.resolveText` would show for a few active locales. */
console.log('');
console.log('--- resolved per active locale ---');
for (const locale of ['zh', 'zh-CN', 'en', 'en-US', 'ja']) {
	const specific = locale.split('-')[0];
	const pick = (field) => (typeof meta[field] === 'string' ? meta[field] : (meta[field][locale] ?? meta[field][specific] ?? meta[field].en));
	console.log(`  ${locale.padEnd(6)} title="${pick('title')}"  description="${pick('description')}"`);
}
