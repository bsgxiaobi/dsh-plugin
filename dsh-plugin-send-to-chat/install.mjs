#!/usr/bin/env node
/**
 * Install `dsh-plugin-send-to-chat` into a local DSH profile.
 *
 * Writes one `insert` row into the profile's own `cordis.patch.yml`, naming this
 * plugin by its absolute path. The DSH patch loader accepts an absolute path (or
 * a file URL) as an inserted plugin name and converts it to a file URL, so this
 * needs no package manager, no registry, and no network.
 *
 * Usage:
 *   node install.mjs                 # patch $DSH_PROFILE, else "desktop"
 *   node install.mjs web             # patch a named profile
 *   node install.mjs --dry-run       # print the row without writing
 *   node install.mjs --home D:\dsh   # override $DSH_HOME
 *   node install.mjs --print         # print the row and exit
 *
 * The write is idempotent: an existing `send-to-chat` row is reported instead of
 * duplicated, and the patch file is backed up before it changes.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

/** This plugin's package root — the directory holding this script. */
const pluginDir = path.dirname(fileURLToPath(import.meta.url));

/** The Loader entry id this installer owns. */
const ENTRY_ID = 'send-to-chat';

/** Parse argv into one profile name plus flags. */
function parseArgs(argv) {
	const options = { profile: undefined, home: undefined, dryRun: false, print: false };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--dry-run') options.dryRun = true;
		else if (arg === '--print') options.print = true;
		else if (arg === '--home') options.home = argv[++index];
		else if (arg.startsWith('--home=')) options.home = arg.slice('--home='.length);
		else if (!arg.startsWith('-') && options.profile === undefined) options.profile = arg;
		else {
			console.error(`install: unrecognized argument "${arg}"`);
			process.exit(2);
		}
	}
	return options;
}

const options = parseArgs(process.argv.slice(2));

/** `$DSH_HOME`, else the conventional `~/.dsh`. */
const dshHome = options.home ?? process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
const profileName = options.profile ?? process.env.DSH_PROFILE ?? 'desktop';
const profileDir = path.join(dshHome, 'profiles', profileName);
const patchPath = path.join(profileDir, 'cordis.patch.yml');

/** The plugin path as the loader wants it: absolute, forward slashes, no spaces handled by quoting. */
const pluginSpec = pluginDir.split(path.sep).join('/');

/** The YAML row to append. */
const ROW = `- insert:\n    - id: ${ENTRY_ID}\n      name: '${pluginSpec}'\n`;

if (options.print) {
	process.stdout.write(ROW);
	process.exit(0);
}

if (!fs.existsSync(profileDir)) {
	console.error(`install: no DSH profile at "${profileDir}"`);
	console.error('install: pass a profile name, or set DSH_HOME to the DSH home directory.');
	console.error(`install: known profiles: ${listProfiles()}`);
	process.exit(1);
}

/** Existing profile names, for a useful error message. */
function listProfiles() {
	const profilesRoot = path.join(dshHome, 'profiles');
	if (!fs.existsSync(profilesRoot)) return '(none)';
	const names = fs
		.readdirSync(profilesRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
		.map((entry) => entry.name);
	return names.length === 0 ? '(none)' : names.join(', ');
}

const existing = fs.existsSync(patchPath) ? fs.readFileSync(patchPath, 'utf8') : '';

// Idempotence: an id-targeted row already exists, whether it was written by this
// script or contributed by an installed bundle. A duplicate id would be a second
// mount of the same plugin.
if (new RegExp(`^\\s*-?\\s*id:\\s*['"]?${ENTRY_ID}['"]?\\s*$`, 'mu').test(existing)) {
	console.log(`install: profile "${profileName}" already has a "${ENTRY_ID}" row — nothing to do.`);
	console.log(`install: patch file: ${patchPath}`);
	process.exit(0);
}

if (options.dryRun) {
	console.log(`install: would append this row to ${patchPath}:`);
	process.stdout.write(ROW);
	process.exit(0);
}

if (!fs.existsSync(patchPath)) {
	fs.mkdirSync(profileDir, { recursive: true });
}

const backupPath = `${patchPath}.bak-${new Date().toISOString().replace(/[-:T]/gu, '').slice(0, 14)}`;
if (fs.existsSync(patchPath)) {
	fs.copyFileSync(patchPath, backupPath);
	console.log(`install: backed up the patch file to ${path.basename(backupPath)}`);
}

const separator = existing === '' || existing.endsWith('\n') ? '' : '\n';
const banner = existing === '' ? '# Your patch layer for this dsh profile.\n' : '';
fs.writeFileSync(patchPath, `${existing}${separator}${banner}${ROW}`, 'utf8');

console.log(`install: added the "${ENTRY_ID}" row to profile "${profileName}"`);
console.log(`install: ${patchPath}`);
console.log(`install: plugin path ${pluginSpec}`);
console.log('');
console.log('Next: restart DSH, or let the running profile hot-reload the patch.');
console.log('If DSH is already open, refresh the page once so the browser half loads.');
