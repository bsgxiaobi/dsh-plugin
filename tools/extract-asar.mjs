// Minimal @electron/asar extractor (pure Node, no deps).
//
// CLI:
//   node tools/extract-asar.mjs <app.asar> <outDir>
//
// Also importable: `const { extractAsar } = await import('./extract-asar.mjs')`
// — tools/check-contract.mjs uses that for its one-shot `--asar` mode.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Unpack an asar archive into `outDir`.
 * @param archivePath - path of the `.asar` file.
 * @param outDir - directory to write the tree into (created if absent).
 * @returns counts and the computed body offset.
 */
export function extractAsar(archivePath, outDir) {
	const fd = fs.openSync(archivePath, 'r');
	try {
		const sizeBuf = Buffer.alloc(8);
		fs.readSync(fd, sizeBuf, 0, 8, 0);
		const headerSize = sizeBuf.readUInt32LE(4);
		const headerBuf = Buffer.alloc(headerSize);
		fs.readSync(fd, headerBuf, 0, headerSize, 8);
		const strLen = headerBuf.readUInt32LE(4);
		const headerJson = headerBuf.subarray(8, 8 + strLen).toString('utf8');
		const header = JSON.parse(headerJson);
		const baseOffset = 8 + headerSize;

		let fileCount = 0;
		let unpackedCount = 0;
		const unpackedRoot = archivePath + '.unpacked';

		const ensureDir = (dir) => {
			fs.mkdirSync(dir, { recursive: true });
		};

		const extractFiles = (node, currentOut) => {
			for (const [name, entry] of Object.entries(node.files ?? {})) {
				const target = path.join(currentOut, name);
				if (entry.files) {
					ensureDir(target);
					extractFiles(entry, target);
					continue;
				}
				if (entry.unpacked) {
					// body lives beside the archive in app.asar.unpacked
					const src = path.join(unpackedRoot, path.relative(outDir, target));
					ensureDir(path.dirname(target));
					if (fs.existsSync(src)) {
						fs.copyFileSync(src, target);
						unpackedCount++;
					}
					continue;
				}
				const offset = baseOffset + Number(entry.offset);
				const size = Number(entry.size);
				const buf = Buffer.alloc(size);
				if (size > 0) fs.readSync(fd, buf, 0, size, offset);
				ensureDir(path.dirname(target));
				fs.writeFileSync(target, buf);
				fileCount++;
			}
		};

		ensureDir(outDir);
		extractFiles(header, outDir);
		return { outDir, fileCount, unpackedCount, baseOffset };
	} finally {
		fs.closeSync(fd);
	}
}

/** Run as a CLI when invoked directly. */
function main(argv) {
	const [, , archivePath, outDir] = argv;
	if (!archivePath || !outDir) {
		console.error('usage: node tools/extract-asar.mjs <app.asar> <outDir>');
		process.exit(2);
	}
	console.log(JSON.stringify(extractAsar(archivePath, outDir)));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main(process.argv);
}
