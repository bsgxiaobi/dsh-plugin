#!/usr/bin/env node
/**
 * Verify this repo's two plugins against a DSH build.
 *
 * DSH publishes no compatibility promise for the internals these plugins use
 * (DOM anchors, the composer insertion seam, slot keys, host events, the web
 * route registry). `tools/contract.json` enumerates every one of them, so an
 * upgrade is a mechanical check instead of a manual review:
 *
 *   node tools/extract-asar.mjs "<app.asar>" "%TEMP%\dsh-src"
 *   node tools/check-contract.mjs "%TEMP%\dsh-src"
 *
 * Or in one step (extracts to a temp dir and removes it afterwards):
 *
 *   node tools/check-contract.mjs --asar "<app.asar>"
 *
 * `--lint` needs no DSH tree at all: it validates tools/contract.json itself
 * (unique ids, compilable regexes, and every `usedAt` file still existing),
 * which is what CI runs on every push so the manifest cannot silently rot.
 *
 * With no argument it looks for an already-unpacked tree at $DSH_SRC_REF,
 * `../.dsh-src-ref`, or `./.dsh-src-ref`.
 *
 * Exit code 0 = every requirement satisfied; 1 = something is missing (or the
 * peer-version ranges no longer hold); 2 = usage error.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(here);

/** Extensions scanned for symbols. */
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.html', '.css', '.map']);

/** Files larger than this are skipped rather than loaded whole. */
const MAX_FILE_BYTES = 64 * 1024 * 1024;

/** Parse argv. */
function parseArgs(argv) {
	const options = { dir: undefined, asar: undefined, keep: false, json: false, lint: false };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--asar') options.asar = argv[++index];
		else if (arg.startsWith('--asar=')) options.asar = arg.slice('--asar='.length);
		else if (arg === '--keep') options.keep = true;
		else if (arg === '--lint') options.lint = true;
		else if (arg === '--json') options.json = true;
		else if (arg === '--help' || arg === '-h') options.help = true;
		else if (arg.startsWith('-')) {
			console.error(`check-contract: unrecognized argument "${arg}"`);
			process.exit(2);
		} else if (options.dir === undefined) options.dir = arg;
		else {
			console.error(`check-contract: unexpected extra argument "${arg}"`);
			process.exit(2);
		}
	}
	return options;
}

const options = parseArgs(process.argv.slice(2));

if (options.help) {
	console.log('usage: node tools/check-contract.mjs [<unpacked-dsh-dir>] [--asar <app.asar>] [--keep] [--json]');
	process.exit(0);
}

/** Locate an unpacked DSH tree: explicit argument, $DSH_SRC_REF, then conventional spots. */
function findSourceDir() {
	if (options.dir !== undefined) return options.dir;
	const candidates = [
		process.env.DSH_SRC_REF,
		path.join(repoRoot, '..', '.dsh-src-ref'),
		path.join(process.cwd(), '.dsh-src-ref'),
	].filter((value) => typeof value === 'string' && value !== '');
	for (const candidate of candidates) {
		if (fs.existsSync(path.join(candidate, 'dsh', 'package.json'))) return candidate;
	}
	return undefined;
}

/** Load the contract next to this script. */
const contractPath = path.join(here, 'contract.json');
if (!fs.existsSync(contractPath)) {
	console.error(`check-contract: missing ${contractPath}`);
	process.exit(2);
}
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));

/**
 * Validate the manifest itself — no DSH tree required. Keeps the contract from
 * rotting: a stale `usedAt` (renamed file) or a duplicate id fails CI.
 * @returns list of problems, empty when the manifest is sound.
 */
function lintContract() {
	const problems = [];
	if (typeof contract.dsh?.manifest !== 'string') problems.push('dsh.manifest 缺失');
	if (typeof contract.dsh?.name !== 'string') problems.push('dsh.name 缺失');
	if (typeof contract.dsh?.tested !== 'string') problems.push('dsh.tested 缺失（记录已知兼容的 DSH 版本）');

	const seen = new Set();
	const requirements = contract.requirements ?? [];
	if (requirements.length === 0) problems.push('requirements 为空');

	for (const requirement of requirements) {
		const id = requirement.id ?? '(无 id)';
		if (typeof requirement.id !== 'string' || requirement.id.trim() === '') problems.push('存在没有 id 的条目');
		else if (seen.has(requirement.id)) problems.push(`${id}: id 重复`);
		else seen.add(requirement.id);

		for (const field of ['plugin', 'kind', 'usedAt', 'why']) {
			if (typeof requirement[field] !== 'string' || requirement[field].trim() === '') problems.push(`${id}: 缺少 ${field}`);
		}
		const needles = requirement.needles ?? [];
		if (needles.length === 0 && requirement.regex === undefined) problems.push(`${id}: needles 与 regex 至少要有一个`);
		if (requirement.regex !== undefined) {
			try {
				new RegExp(requirement.regex, 'u');
			} catch (error) {
				problems.push(`${id}: regex 无法编译 (${String(error)})`);
			}
		}
		// `usedAt` looks like "path/to/file.js:123"; the file must still exist.
		const target = String(requirement.usedAt ?? '').replace(/:\d+(?:-\d+)?$/u, '');
		if (target !== '' && !target.includes(' ') && fs.existsSync(path.join(repoRoot, target)) === false && /^[\w./-]+$/u.test(target)) {
			problems.push(`${id}: usedAt 指向的文件不存在 -> ${target}`);
		}
	}

	for (const peer of contract.dsh?.peers ?? []) {
		if (typeof peer.source !== 'string' || !fs.existsSync(path.join(repoRoot, peer.source))) {
			problems.push(`peer ${peer.plugin ?? '?'}: source 文件不存在 -> ${peer.source}`);
			continue;
		}
		const pluginManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, peer.source), 'utf8'));
		if (pluginManifest.peerDependencies?.[peer.package] === undefined) {
			problems.push(`peer ${peer.plugin}: ${peer.source} 里没有声明 peerDependencies["${peer.package}"]`);
		}
	}
	return problems;
}

if (options.lint) {
	const problems = lintContract();
	if (problems.length === 0) {
		console.log(`contract.json 体检通过：${(contract.requirements ?? []).length} 条符号契约、${(contract.dsh.peers ?? []).length} 条版本契约。`);
		process.exit(0);
	}
	console.error(`contract.json 体检失败（${problems.length} 项）：`);
	for (const problem of problems) console.error(`  - ${problem}`);
	process.exit(1);
}

/** One `~`/`^`/exact comparator — enough for the ranges this repo declares. */
function satisfies(version, range) {
	const wanted = String(range).trim();
	if (wanted === '*' || wanted === '' || wanted === 'x') return true;
	const tilde = wanted.startsWith('~');
	const caret = wanted.startsWith('^');
	const floor = wanted.replace(/^[\^~>=]+/u, '').trim();
	const parse = (value) => String(value).split('.').map((part) => Number.parseInt(part, 10) || 0);
	const [wantMajor, wantMinor, wantPatch] = parse(floor);
	const [gotMajor, gotMinor, gotPatch] = parse(version);
	if (tilde) return gotMajor === wantMajor && gotMinor === wantMinor && gotPatch >= wantPatch;
	if (caret) {
		if (gotMajor !== wantMajor) return false;
		if (gotMinor !== wantMinor) return gotMinor > wantMinor;
		return gotPatch >= wantPatch;
	}
	return gotMajor === wantMajor && gotMinor === wantMinor && gotPatch >= wantPatch;
}

/** Recursively collect scannable files. */
function collectFiles(root) {
	const files = [];
	const walk = (dir) => {
		let entries;
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(full);
		}
	};
	walk(root);
	return files;
}

/** Match one requirement against one file's text. */
function matches(requirement, text) {
	for (const needle of requirement.needles ?? []) {
		if (text.includes(needle)) return needle;
	}
	if (requirement.regex !== undefined) {
		const found = new RegExp(requirement.regex, 'u').exec(text);
		if (found !== null) return `/${requirement.regex}/`;
	}
	return undefined;
}

/** Extract `app.asar` through the sibling tool so `--asar` is a one-liner. */
async function prepareSource() {
	if (options.asar === undefined) {
		const dir = findSourceDir();
		if (dir === undefined) {
			console.error('check-contract: no unpacked DSH tree found.');
			console.error('check-contract: pass a directory, or use --asar "<app.asar>", or set DSH_SRC_REF.');
			process.exit(2);
		}
		if (!fs.existsSync(path.join(dir, 'dsh', 'package.json'))) {
			console.error(`check-contract: "${dir}" does not look like an unpacked DSH tree (no dsh/package.json).`);
			process.exit(2);
		}
		return { dir: path.resolve(dir), cleanup: false };
	}
	if (!fs.existsSync(options.asar)) {
		console.error(`check-contract: no such archive "${options.asar}"`);
		process.exit(2);
	}
	const { extractAsar } = await import(pathToFileURL(path.join(here, 'extract-asar.mjs')).href);
	const outDir = options.keep
		? path.join(repoRoot, '..', '.dsh-src-ref')
		: fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-contract-'));
	console.error(`check-contract: extracting ${path.basename(options.asar)} -> ${outDir}`);
	extractAsar(options.asar, outDir);
	return { dir: path.resolve(outDir), cleanup: !options.keep };
}

const source = await prepareSource();

const manifestPath = path.join(source.dir, contract.dsh.manifest);
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : undefined;
const installed = { ...(manifest?.dependencies ?? {}) };

const files = collectFiles(source.dir);
const pending = (contract.requirements ?? []).map((requirement) => ({ ...requirement, matchedIn: undefined, via: undefined }));
let bytes = 0;
let scanned = 0;

for (const file of files) {
	if (pending.every((requirement) => requirement.matchedIn !== undefined)) break;
	let stat;
	try {
		stat = fs.statSync(file);
	} catch {
		continue;
	}
	if (stat.size > MAX_FILE_BYTES) continue;
	let text;
	try {
		text = fs.readFileSync(file, 'utf8');
	} catch {
		continue;
	}
	scanned += 1;
	bytes += stat.size;
	for (const requirement of pending) {
		if (requirement.matchedIn !== undefined) continue;
		const via = matches(requirement, text);
		if (via !== undefined) {
			requirement.matchedIn = path.relative(source.dir, file).split(path.sep).join('/');
			requirement.via = via;
		}
	}
}

const missing = pending.filter((requirement) => requirement.matchedIn === undefined);
const found = pending.filter((requirement) => requirement.matchedIn !== undefined);

/** Peer ranges declared by the plugins, compared against the installed tree. */
const peerResults = (contract.dsh.peers ?? []).map((peer) => {
	const pluginManifestPath = path.join(repoRoot, peer.source);
	let range = peer.expected;
	if (fs.existsSync(pluginManifestPath)) {
		const pluginManifest = JSON.parse(fs.readFileSync(pluginManifestPath, 'utf8'));
		range = pluginManifest.peerDependencies?.[peer.package] ?? range;
	}
	const version = installed[peer.package];
	return {
		...peer,
		range,
		version,
		ok: version !== undefined && satisfies(version, range),
	};
});

const peerFailures = peerResults.filter((peer) => !peer.ok);
const ok = missing.length === 0 && peerFailures.length === 0;

if (options.json) {
	process.stdout.write(
		`${JSON.stringify(
			{
				source: source.dir,
				dshPackage: manifest?.name,
				dshVersion: manifest?.version,
				scannedFiles: scanned,
				scannedBytes: bytes,
				ok,
				found: found.map((requirement) => ({ id: requirement.id, via: requirement.via, in: requirement.matchedIn })),
				missing: missing.map((requirement) => ({ id: requirement.id, kind: requirement.kind, plugin: requirement.plugin, usedAt: requirement.usedAt, why: requirement.why })),
				peers: peerResults,
			},
			null,
			2,
		)}\n`,
	);
} else {
	console.log('DSH 契约检查');
	console.log(`  源      : ${source.dir}`);
	console.log(`  版本    : ${manifest?.name ?? '(未知)'} ${manifest?.version ?? ''}`);
	console.log(`  扫描    : ${scanned} 个文本文件 / ${(bytes / 1024 / 1024).toFixed(1)} MB`);
	console.log('');
	console.log('符号契约');
	for (const requirement of pending) {
		const mark = requirement.matchedIn === undefined ? '✗' : '✓';
		const where = requirement.matchedIn === undefined ? '' : `  ← ${requirement.matchedIn}`;
		console.log(`  ${mark} ${requirement.id.padEnd(34)} ${String(requirement.via ?? '-').padEnd(28)}${where}`);
		if (requirement.matchedIn === undefined) {
			console.log(`      ↳ ${requirement.kind} · ${requirement.plugin} · 用在 ${requirement.usedAt}`);
			console.log(`      ↳ ${requirement.why}`);
			const needle = (requirement.needles ?? [])[0] ?? requirement.regex;
			console.log(`      ↳ 自查: rg -l --fixed-strings ${JSON.stringify(needle)} "${source.dir}"`);
		}
	}
	console.log('');
	console.log('版本契约');
	for (const peer of peerResults) {
		const mark = peer.ok ? '✓' : '✗';
		console.log(`  ${mark} ${peer.plugin} 要求 ${peer.package} ${peer.range}，实装 ${peer.version ?? '(缺失)'}`);
	}
	console.log('');
	const total = pending.length + peerResults.length;
	const passed = found.length + peerResults.filter((peer) => peer.ok).length;
	if (ok) {
		console.log(`结论: 全部通过（${passed}/${total}）—— 这版 DSH 与两个插件兼容。`);
	} else {
		console.log(`结论: ${passed}/${total} 通过，${missing.length + peerFailures.length} 项需要处理。`);
		console.log('     以上标 ✗ 的就是这次升级影响到的面；按 usedAt 去改对应插件文件。');
	}
}

if (source.cleanup) {
	try {
		fs.rmSync(source.dir, { recursive: true, force: true });
	} catch {
		/* temp dir, best effort */
	}
}

process.exit(ok ? 0 : 1);
