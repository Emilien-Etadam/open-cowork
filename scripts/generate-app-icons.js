#!/usr/bin/env node
/**
 * Generate platform app icons and tray assets from resources/logo.png.
 *
 * Outputs:
 *   resources/icon.png, icon.ico, icon.icns, icon.iconset/*
 *   resources/tray-icon.png, tray-icon.ico, tray-iconTemplate.png
 *   public/favicon.png, public/logo.png
 *   src/renderer/assets/logo.png
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const sharp = require('sharp');
const pngToIco = require('png-to-ico');

const PROJECT_ROOT = path.join(__dirname, '..');
const LOGO_PATH = path.join(PROJECT_ROOT, 'resources', 'logo.png');
const LOGO_COPIES = [
  path.join(PROJECT_ROOT, 'public', 'logo.png'),
  path.join(PROJECT_ROOT, 'src', 'renderer', 'assets', 'logo.png'),
];
const RESOURCES_DIR = path.join(PROJECT_ROOT, 'resources');
const ICONSET_DIR = path.join(RESOURCES_DIR, 'icon.iconset');
const PUBLIC_FAVICON = path.join(PROJECT_ROOT, 'public', 'favicon.png');

const ICONSET_SIZES = [
  { name: 'icon_16x16.png', size: 16 },
  { name: 'icon_16x16@2x.png', size: 32 },
  { name: 'icon_32x32.png', size: 32 },
  { name: 'icon_32x32@2x.png', size: 64 },
  { name: 'icon_128x128.png', size: 128 },
  { name: 'icon_128x128@2x.png', size: 256 },
  { name: 'icon_256x256.png', size: 256 },
  { name: 'icon_256x256@2x.png', size: 512 },
  { name: 'icon_512x512.png', size: 512 },
  { name: 'icon_512x512@2x.png', size: 1024 },
];

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const TRAY_SIZES = [16, 22, 32];

async function resizePng(input, outputPath, size) {
  await sharp(input)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(outputPath);
}

async function resizePngBuffer(input, size) {
  return sharp(input)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

async function createTrayTemplate(input, outputPath, size) {
  await sharp(input)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .grayscale()
    .linear(1.2, -20)
    .png()
    .toFile(outputPath);
}

async function generateIconset(logoPath) {
  fs.mkdirSync(ICONSET_DIR, { recursive: true });
  for (const { name, size } of ICONSET_SIZES) {
    await resizePng(logoPath, path.join(ICONSET_DIR, name), size);
  }
}

async function generateIcns() {
  const icnsPath = path.join(RESOURCES_DIR, 'icon.icns');
  if (process.platform === 'darwin') {
    execFileSync('iconutil', ['-c', 'icns', ICONSET_DIR, '-o', icnsPath], { stdio: 'inherit' });
    return;
  }

  const png2icons = require('png2icons');
  const source = fs.readFileSync(path.join(RESOURCES_DIR, 'icon.png'));
  const icns = png2icons.createICNS(source, png2icons.BILINEAR, 0);
  if (!icns) {
    throw new Error('png2icons failed to create icon.icns');
  }
  fs.writeFileSync(icnsPath, icns);
}

async function generateIco(logoPath, outputPath, sizes) {
  const buffers = await Promise.all(sizes.map((size) => resizePngBuffer(logoPath, size)));
  const ico = await pngToIco(buffers);
  fs.writeFileSync(outputPath, ico);
}

function propagateLogoCopies(logoPath) {
  for (const destination of LOGO_COPIES) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(logoPath, destination);
  }
}

async function main() {
  if (!fs.existsSync(LOGO_PATH)) {
    console.error(`[generate:icons] Missing source logo: ${LOGO_PATH}`);
    process.exit(1);
  }

  console.log('[generate:icons] Generating icons from', LOGO_PATH);

  await resizePng(LOGO_PATH, path.join(RESOURCES_DIR, 'icon.png'), 512);
  await generateIconset(LOGO_PATH);
  await generateIcns();
  await generateIco(LOGO_PATH, path.join(RESOURCES_DIR, 'icon.ico'), ICO_SIZES);

  await resizePng(LOGO_PATH, path.join(RESOURCES_DIR, 'tray-icon.png'), 32);
  await createTrayTemplate(LOGO_PATH, path.join(RESOURCES_DIR, 'tray-iconTemplate.png'), 22);
  await generateIco(LOGO_PATH, path.join(RESOURCES_DIR, 'tray-icon.ico'), TRAY_SIZES);

  await resizePng(LOGO_PATH, PUBLIC_FAVICON, 32);
  propagateLogoCopies(LOGO_PATH);

  console.log('[generate:icons] Done.');
}

main().catch((error) => {
  console.error('[generate:icons] Failed:', error);
  process.exit(1);
});
