// Minimal @electron/asar extractor (pure Node, no deps).
import fs from 'node:fs';
import path from 'node:path';

const [, , archivePath, outDir] = process.argv;
if (!archivePath || !outDir) {
  console.error('usage: node dsh-asar-extract.mjs <app.asar> <outDir>');
  process.exit(2);
}

const fd = fs.openSync(archivePath, 'r');
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

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function extractFiles(node, currentOut) {
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
}

ensureDir(outDir);
extractFiles(header, outDir);
fs.closeSync(fd);
console.log(JSON.stringify({ outDir, fileCount, unpackedCount, baseOffset }));
