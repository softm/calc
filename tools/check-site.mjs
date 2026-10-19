import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SourceTextModule } from 'node:vm';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PAGES_BASE = new URL('https://softm.github.io/calc/');
const REQUIRED_FILES = [
  'index.html', 'styles.css', 'app.js', 'engine.js', 'notes.js', 'notes.css',
  'manifest.webmanifest', 'sw.js', 'icons/icon.svg', 'icons/icon-192.png',
  'icons/icon-512.png', 'package.json', 'README.md', '.nojekyll'
];
const errors = new Set();
const verifiedFiles = new Map();
const sources = new Map();

function fail(message) {
  errors.add(message);
}

async function exists(path) {
  if (verifiedFiles.has(path)) return verifiedFiles.get(path);
  let found = false;
  try {
    found = (await stat(join(ROOT, path))).isFile();
  } catch {
    // Include a useful owner in the caller's diagnostic.
  }
  verifiedFiles.set(path, found);
  return found;
}

async function read(path) {
  if (sources.has(path)) return sources.get(path);
  const text = await readFile(join(ROOT, path), 'utf8');
  sources.set(path, text);
  return text;
}

async function resolveAsset(raw, owner) {
  const reference = raw.trim().replaceAll('&amp;', '&');
  if (!reference || reference.startsWith('#') || reference.startsWith('data:')) return null;
  if (reference.startsWith('/') || reference.startsWith('\\')) {
    fail(owner + ': 하위 경로 배포를 위해 상대 경로를 사용하세요: ' + reference);
  }
  let url;
  try {
    url = new URL(reference, new URL(owner, PAGES_BASE));
  } catch {
    fail(owner + ': 잘못된 리소스 경로: ' + reference);
    return null;
  }
  if (url.origin !== PAGES_BASE.origin || !url.pathname.startsWith(PAGES_BASE.pathname)) {
    fail(owner + ': 앱 범위 밖의 리소스 참조: ' + reference);
    return null;
  }
  let path;
  try {
    path = decodeURIComponent(url.pathname.slice(PAGES_BASE.pathname.length));
  } catch {
    fail(owner + ': 경로의 URL 인코딩을 읽을 수 없습니다: ' + reference);
    return null;
  }
  if (path.includes('\\') || path.split('/').includes('..')) {
    fail(owner + ': 정적 사이트 범위를 벗어나는 경로: ' + reference);
    return null;
  }
  if (!path || path.endsWith('/')) path += 'index.html';
  if (!await exists(path)) {
    fail(owner + ': 참조한 파일이 없습니다: ' + reference + ' → ' + path);
    return null;
  }
  return path;
}

function attributes(source) {
  const result = {};
  const pattern = /([^\s=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/gu;
  for (const match of source.matchAll(pattern)) {
    result[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return result;
}

function htmlReferences(source) {
  const refs = [];
  const tags = /<(script|link|img|source|video|audio|object|iframe)\b([^>]*)>/giu;
  for (const match of source.matchAll(tags)) {
    const tag = match[1].toLowerCase();
    const attrs = attributes(match[2]);
    if (tag === 'link') {
      const rel = (attrs.rel || '').split(/\s+/u);
      const loadsResource = rel.some(function (value) {
        return ['stylesheet', 'manifest', 'icon', 'apple-touch-icon', 'preload', 'modulepreload'].includes(value);
      });
      if (loadsResource && attrs.href) refs.push(attrs.href);
    } else {
      if (attrs.src) refs.push(attrs.src);
      if (attrs.poster) refs.push(attrs.poster);
      if (tag === 'object' && attrs.data) refs.push(attrs.data);
      if (attrs.srcset && !attrs.srcset.startsWith('data:')) {
        for (const candidate of attrs.srcset.split(',')) {
          const ref = candidate.trim().split(/\s+/u)[0];
          if (ref) refs.push(ref);
        }
      }
    }
  }
  return refs;
}

function cssReferences(source) {
  const refs = [];
  const urls = /url\(\s*(['"]?)([^)'"]+)\1\s*\)/gu;
  for (const match of source.matchAll(urls)) refs.push(match[2]);
  const imports = /@import\s+(['"])([^'"]+)\1/gu;
  for (const match of source.matchAll(imports)) refs.push(match[2]);
  return refs;
}

function moduleReferences(source) {
  const refs = [];
  const patterns = [
    /\b(?:import|export)\s+(?:[^;'"()]*?\s+from\s*)?(['"])([^'"]+)\1/gu,
    /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/gu,
    /\bnew\s+URL\s*\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url/gu,
    /\bserviceWorker\.register\s*\(\s*(['"])([^'"]+)\1/gu,
    /\b(?:fetch|importScripts)\s*\(\s*(['"])([^'"]+)\1/gu
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const ref = match[2];
      if (ref.startsWith('node:') || (!ref.startsWith('.') && !ref.startsWith('/') && !ref.includes(':'))) {
        fail('브라우저 모듈에 번들러 없이 해석할 수 없는 import가 있습니다: ' + ref);
      } else {
        refs.push(ref);
      }
    }
  }
  return refs;
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

for (const path of REQUIRED_FILES) {
  if (!await exists(path)) fail('필수 파일이 없습니다: ' + path);
}

const jsFiles = (await walk(ROOT)).filter(function (path) {
  return path.endsWith('.js') || path.endsWith('.mjs');
});
for (const path of jsFiles) {
  const displayPath = relative(ROOT, path).split(sep).join('/');
  try {
    // Parse ES modules without executing site code or spawning child processes.
    new SourceTextModule(await readFile(path, 'utf8'), { identifier: displayPath });
  } catch (error) {
    fail(displayPath + ': JavaScript 구문 오류: ' + error.message);
  }
}

let manifest = null;
if (await exists('manifest.webmanifest')) {
  try {
    manifest = JSON.parse(await read('manifest.webmanifest'));
    for (const key of ['id', 'start_url', 'scope']) {
      if (manifest[key] !== './') {
        fail('manifest.webmanifest: ' + key + '는 배포 경로를 따르도록 "./"이어야 합니다.');
      }
    }
    if (manifest.display !== 'standalone') fail('manifest.webmanifest: display가 standalone이 아닙니다.');
    if (!Array.isArray(manifest.icons)) fail('manifest.webmanifest: icons 배열이 없습니다.');
  } catch (error) {
    fail('manifest.webmanifest: JSON 읽기 실패: ' + error.message);
  }
}

if (await exists('index.html')) {
  const html = await read('index.html');
  if (!/<html\b[^>]*\blang\s*=\s*["']ko(?:-KR)?["']/iu.test(html)) {
    fail('index.html: 한국어 lang 속성이 필요합니다.');
  }
  if (!/<meta\b[^>]*\bname\s*=\s*["']viewport["']/iu.test(html)) {
    fail('index.html: 모바일 viewport 메타 태그가 없습니다.');
  }
  if (!/<link\b[^>]*\brel\s*=\s*["']manifest["']/iu.test(html)) {
    fail('index.html: PWA manifest 연결이 없습니다.');
  }
}

const reachable = new Set();
const queue = ['index.html', 'manifest.webmanifest', 'sw.js'];
while (queue.length) {
  const path = queue.shift();
  if (reachable.has(path) || !await exists(path)) continue;
  reachable.add(path);
  let refs = [];
  if (path.endsWith('.html')) refs = htmlReferences(await read(path));
  else if (path.endsWith('.css')) refs = cssReferences(await read(path));
  else if (path.endsWith('.js') || path.endsWith('.mjs')) refs = moduleReferences(await read(path));
  else if (path === 'manifest.webmanifest' && Array.isArray(manifest?.icons)) {
    refs = manifest.icons.map(function (icon) { return icon.src; }).filter(function (ref) {
      return typeof ref === 'string';
    });
  }
  for (const ref of refs) {
    const target = await resolveAsset(ref, path);
    if (target && !reachable.has(target)) queue.push(target);
  }
}

if (Array.isArray(manifest?.icons)) {
  for (const size of [192, 512]) {
    const expected = size + 'x' + size;
    const icon = manifest.icons.find(function (entry) {
      return entry.sizes?.split(/\s+/u).includes(expected) && entry.type === 'image/png';
    });
    if (!icon || typeof icon.src !== 'string') {
      fail('manifest.webmanifest: ' + expected + ' PNG 아이콘이 없습니다.');
      continue;
    }
    const path = await resolveAsset(icon.src, 'manifest.webmanifest');
    if (!path) continue;
    const bytes = await readFile(join(ROOT, path));
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature) ||
        bytes.readUInt32BE(16) !== size || bytes.readUInt32BE(20) !== size) {
      fail(path + ': 실제 PNG 크기가 manifest의 ' + expected + '와 다릅니다.');
    }
  }
}

let cachedAssets = new Set();
if (await exists('sw.js')) {
  const worker = await read('sw.js');
  if (!/\bconst\s+CACHE_VERSION\s*=\s*(['"])[^'"]+\1/u.test(worker)) {
    fail('sw.js: 명시적인 CACHE_VERSION 상수가 없습니다.');
  }
  const list = worker.match(/\bconst\s+PRECACHE_ASSETS\s*=\s*\[([\s\S]*?)\]\s*;/u);
  if (!list) {
    fail('sw.js: PRECACHE_ASSETS 배열을 읽을 수 없습니다.');
  } else {
    for (const match of list[1].matchAll(/(['"])([^'"]+)\1/gu)) {
      const path = await resolveAsset(match[2], 'sw.js');
      if (path) cachedAssets.add(path);
    }
    const expectedOffline = new Set([
      ...reachable,
      'index.html', 'styles.css', 'app.js', 'engine.js', 'notes.js', 'notes.css',
      'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'
    ]);
    expectedOffline.delete('sw.js');
    for (const path of expectedOffline) {
      if (!cachedAssets.has(path)) fail('sw.js: 오프라인 캐시에 필요한 리소스가 누락됐습니다: ' + path);
    }
  }
}

if (errors.size) {
  console.error('정적 사이트 검사 실패 (' + errors.size + '건)');
  for (const message of errors) console.error('  - ' + message);
  process.exitCode = 1;
} else {
  console.log('정적 사이트 검사 통과');
  console.log('  배포 기준: ' + PAGES_BASE.href);
  console.log('  JavaScript 구문: ' + jsFiles.length + '개');
  console.log('  연결된 정적 리소스: ' + reachable.size + '개');
  console.log('  오프라인 캐시: ' + cachedAssets.size + '개');
  console.log('  manifest, PNG 크기, 상대 경로, 모듈 참조를 확인했습니다.');
}
