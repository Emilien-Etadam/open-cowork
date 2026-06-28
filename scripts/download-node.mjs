#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadAndExtract, PLATFORMS } from './lib/node-runtime.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '..', 'resources', 'node');
const DOWNLOAD_ALL_PLATFORMS = process.env.OPEN_COWORK_DOWNLOAD_ALL_NODE_BINARIES === '1';

async function main() {
  console.log('Downloading Node.js binaries...\n');

  const downloads = [];
  const platformsToDownload = DOWNLOAD_ALL_PLATFORMS
    ? Object.entries(PLATFORMS)
    : [[process.platform, PLATFORMS[process.platform] || {}]];

  if (!DOWNLOAD_ALL_PLATFORMS) {
    console.log(`Current platform only: ${process.platform}-${process.arch}`);
  }

  for (const [platform, arches] of platformsToDownload) {
    const archList = DOWNLOAD_ALL_PLATFORMS ? Object.keys(arches) : [process.arch];
    for (const arch of archList) {
      downloads.push(
        downloadAndExtract({ outputDir: OUTPUT_DIR, platform, arch }).then((dir) => {
          console.log(`✓ Extracted: ${dir}`);
        })
      );
    }
  }

  await Promise.all(downloads);
  console.log('\n✓ All Node.js binaries downloaded!');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
