import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(REPO_ROOT, '.cf-dist');
const IS_DRY = process.argv.includes('--dry');

const ALLOWLIST = [
  'index.html',
  'sw.js',
  'manifest.json',
  'icon.svg',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
  'icon-512-maskable.png',
  'Sync-Apple-Health.shortcut',
];

function buildDist() {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });
  const copied = [];
  for (const rel of ALLOWLIST) {
    const src = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(src)) {
      throw new Error(`Missing required public file: ${rel}`);
    }
    const dst = path.join(DIST_DIR, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    copied.push(rel);
  }
  return copied;
}

const copied = buildDist();
console.log(`[deploy_cf:fitness] Staged ${copied.length} allowlisted public files into .cf-dist:`);
for (const f of copied) console.log(`  + ${f}`);

if (IS_DRY) {
  console.log('[deploy_cf:fitness] --dry mode: skipping wrangler deploy.');
  process.exit(0);
}

execFileSync('npx', ['--no-install', 'wrangler', 'deploy'], {
  cwd: REPO_ROOT,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
