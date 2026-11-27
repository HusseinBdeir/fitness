const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

// 1. Version parity & <script id="pre">
assert.ok(html.includes('<script id="pre">'), 'missing <script id="pre">');
assert.ok(html.includes('manifest.json?v=14.9'), 'index.html missing v=14.9 manifest');
assert.ok(sw.includes('const CACHE = "ubp-pwa-v14.9"'), 'sw.js missing v=14.9 CACHE');
for (const icon of manifest.icons) {
  assert.ok(icon.src.includes('?v=14.9'), `manifest icon not bumped to v=14.9: ${icon.src}`);
}

// 2. Shortcut URLs & signed binary
assert.ok(
  html.includes('href="https://theo.husseinbdeir.workers.dev/assets/Sync-Apple-Health.shortcut"'),
  'Shortcut href not pointed to theo.husseinbdeir.workers.dev/assets/'
);
assert.ok(
  html.includes('https://fitness.husseinbdeir.workers.dev/?health_sc_missing=1'),
  'x-error not pointed to fitness.husseinbdeir.workers.dev'
);
const scPath = path.join(ROOT, 'Sync-Apple-Health.shortcut');
assert.equal(fs.readFileSync(scPath).subarray(0, 4).toString('ascii'), 'AEA1', 'fitness shortcut not AEA1');
const theoScPath = path.resolve(ROOT, '..', 'theo', 'assets', 'Sync-Apple-Health.shortcut');
assert.equal(fs.readFileSync(theoScPath).subarray(0, 4).toString('ascii'), 'AEA1', 'theo/assets shortcut not AEA1');

// 3. Extract inline main script from index.html and exercise migration functions in sandbox
const scriptMatch = html.match(/<script>([\s\S]*)<\/script>\s*<\/body>/);
assert.ok(scriptMatch, 'could not extract main <script>');
let scriptBody = scriptMatch[1];
scriptBody = scriptBody.replace(/try\{\s*document\.addEventListener\("touchstart"[\s\S]*initStore\(\);/, '');

function makeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    get length() { return map.size; },
    key(i) { return Array.from(map.keys())[i] ?? null; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(String(k), String(v)); },
    removeItem(k) { map.delete(k); },
    _dump() { return Object.fromEntries(map.entries()); },
  };
}

let replacedUrl = null;
const ls = makeStorage({
  'ubp.hussein.plan': JSON.stringify({ rev: 5000, bodyweight: 86 }),
  'ubp.hussein.sessions': JSON.stringify([{ id: 's1', date: '2026-11-20', session: 'A' }]),
  'ubp.hussein.pending': JSON.stringify({ plan: false, sessions: {} }),
  'ubp.devid': JSON.stringify('dev_new_1'),
});
const sandbox = {
  console,
  Buffer,
  TextEncoder,
  TextDecoder,
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  localStorage: ls,
  sessionStorage: makeStorage(),
  location: {
    hostname: 'fitness.husseinbdeir.workers.dev',
    pathname: '/',
    search: '',
    hash: '',
  },
  history: {
    replaceState(_s, _t, u) {
      replacedUrl = u;
      sandbox.location.hash = '';
    },
  },
  document: {
    getElementById: () => ({ addEventListener: () => {}, querySelector: () => ({}), className: '', title: '' }),
    querySelector: () => ({ addEventListener: () => {} }),
    querySelectorAll: () => [],
    addEventListener: () => {},
  },
  window: { addEventListener: () => {}, history: null },
  navigator: { userAgent: 'Mozilla/5.0' },
  ResizeObserver: undefined,
};
sandbox.window.history = sandbox.history;
sandbox.window.localStorage = ls;
sandbox.window.sessionStorage = sandbox.sessionStorage;

const ctx = vm.createContext(sandbox);
vm.runInContext(scriptBody, ctx);

(async () => {
  const same = (a) => JSON.parse(JSON.stringify(a));
  // Negative & boundary validation on captureAndApplyHashMigration
  sandbox.location.hash = '#migrate=' + 'a'.repeat(262145);
  assert.deepEqual(same(sandbox.captureAndApplyHashMigration()), { ok: false, reason: 'size' });
  assert.equal(sandbox.location.hash, '', 'oversized hash must still be stripped');

  sandbox.location.hash = '#migrate=%%%not_base64%%%';
  assert.deepEqual(same(sandbox.captureAndApplyHashMigration()), { ok: false, reason: 'parse' });

  sandbox.location.hash = '#migrate=' + sandbox.encodeB64uJson({ v: 2, app: 'other', kv: {} });
  assert.deepEqual(same(sandbox.captureAndApplyHashMigration()), { ok: false, reason: 'schema' });

  // Malicious key & value rejection + session union merge + plan pending marking
  const testPayload = {
    v: 1,
    app: 'fitness',
    oldDevId: 'dev_old_github',
    ts: Date.now(),
    kv: {
      'ubp.profile': { bad: 1 }, // invalid type -> rejected
      'ubp.profiles': [
        { id: '../push_registry', name: 'Bad' }, // path traversal -> rejected
        { id: 'hussein', name: 'Hussein' },
      ],
      'ubp.hussein.plan': { rev: 1000, bodyweight: 70 }, // older rev -> must NOT overwrite local 5000
      'ubp.ali.plan': { rev: 2000, bodyweight: 75 }, // new profile plan -> imported AND pending.plan marked
      'ubp.bad.plan': [], // array -> rejected
      'ubp.hussein.sessions': [
        { id: 's1', date: '2026-11-20', session: 'A' },
        { id: 's2', date: '2026-11-22', session: 'B', exercises: [{ name: 'Row', unit: 'kg', sets: [{ w: 60, r: 10 }] }] },
        { id: 's3', date: '2026-11-23', session: 'A' }, // NOT listed in incoming pending -> must still get marked 'set'
        { id: 's_xss', date: '2026-11-22', session: '"><img src=x onerror=alert(1)>' },
        { id: 's_bad_date', date: 'not-a-date', session: 'A' },
      ],
      'ubp.hussein.draft': { id: 'bad_draft', exercises: [null] }, // invalid draft -> rejected
      'ubp.hussein.pending': { plan: false, sessions: { s2: 'set', __proto__: 'set' } },
      'ubp.xss.plan': {
        rev: 9999999999999,
        v: 2,
        health: {
          [new Date().toISOString().slice(0, 10)]: {
            source: 'Manual<img src=x onerror=alert(1)>',
            rhr: '<img src=x onerror=alert(1)>',
            sleep: '<img src=x onerror=alert(2)>',
            spo2: '<img src=x onerror=alert(3)>',
            respRate: '<img src=x onerror=alert(4)>',
          },
        },
        sessions: {
          gym: {
            A: [
              { ex: 'unknown_ex', sets: 3, min: 8, max: 12, inc: 5 },
              { ex: 'bench', sets: '3" autofocus onfocus="alert(1)', min: 8, max: 12, inc: 5, unit: 'kg' },
            ],
          },
        },
      },
      'ubp.hussein.hsync': { autoSync: true, everSynced: true },
      '__proto__': { polluted: true },
      'evil_arbitrary_key': 'bad',
      'theo_cmd_store_key_v1': 'stolen',
    },
  };
  sandbox.location.hash = `#migrate=${sandbox.encodeB64uJson(testPayload)}`;
  const res = sandbox.captureAndApplyHashMigration();
  assert.equal(res.ok, true);
  assert.equal(replacedUrl, '/', 'hash must be stripped immediately via replaceState');
  assert.equal(sandbox.location.hash, '');
  assert.equal(ls.getItem('ubp.profile'), null, 'non-string ubp.profile rejected');
  assert.equal(ls.getItem('ubp.bad.plan'), null, 'array .plan rejected');
  assert.equal(ls.getItem('evil_arbitrary_key'), null, 'non-ubp key rejected');
  assert.equal(ls.getItem('theo_cmd_store_key_v1'), null, 'foreign key rejected');
  assert.equal(({}).polluted, undefined, 'prototype must not be polluted');
  const profiles = JSON.parse(ls.getItem('ubp.profiles'));
  assert.deepEqual(profiles.map((p) => p.id), ['hussein'], 'path-traversal profile id rejected');
  assert.equal(JSON.parse(ls.getItem('ubp.hussein.plan')).bodyweight, 86, 'newer local plan rev must not be clobbered');
  assert.equal(JSON.parse(ls.getItem('ubp.ali.plan')).bodyweight, 75, 'valid newer plan imported');
  assert.equal(JSON.parse(ls.getItem('ubp.ali.pending')).plan, true, 'imported plan marks pending.plan');
  const mergedSess = JSON.parse(ls.getItem('ubp.hussein.sessions'));
  assert.deepEqual(mergedSess.map((s) => s.id), ['s1', 's2', 's3'], 'sessions union-merged without losing s1 and rejecting XSS/bad-date sessions');
  const mergedPend = JSON.parse(ls.getItem('ubp.hussein.pending'));
  assert.equal(mergedPend.sessions.s2, 'set', 'pre-existing pending must preserve s2:set across migration');
  assert.equal(mergedPend.sessions.s3, 'set', 'newly imported session absent from incoming pending must get s3:set');
  assert.equal(ls.getItem('ubp.hussein.draft'), null, 'malformed draft with null exercise rejected');

  // Verify migrated plan health & sessions are sanitized and render zero XSS in Today/Health/Plan
  const xssPlan = JSON.parse(ls.getItem('ubp.xss.plan'));
  assert.equal(xssPlan.sessions.gym.A.length, 1, 'unknown_ex stripped by migratePlan');
  assert.equal(xssPlan.sessions.gym.A[0].sets, 3, 'XSS attribute in sets coerced to finite number');
  vm.runInContext(`state.profile="xss";state.plan=lsGet("ubp.xss.plan");state.sessions=[];`, ctx);
  const renderedAll = vm.runInContext('renderToday() + renderHealth() + renderPlan() + renderLog()', ctx);
  assert.ok(!/<img|onerror=|onfocus=/i.test(renderedAll), 'rendered views must contain zero injected HTML or event handlers');

  // Failure mode: retireOldPushDevice MUST keep pushRetired=false when get() rejects
  const failDb = {
    _http: true,
    doc() {
      return {
        async get() { throw new Error('network down'); },
        async set() { throw new Error('should not write'); },
      };
    },
  };
  const failRetire = await sandbox.retireOldPushDevice(failDb);
  assert.equal(failRetire, false);
  assert.equal(JSON.parse(ls.getItem('ubp.migrated_from')).pushRetired, false);

  // Success mode: retireOldPushDevice removes ONLY oldDevId
  let savedRegistry = null;
  const okDb = {
    _http: true,
    doc(p) {
      assert.equal(p, 'push_registry');
      return {
        async get() {
          return {
            exists: true,
            data: () => ({
              items: [
                { id: 'dev_old_github', pid: 'hussein', endpoint: 'https://push/old' },
                { id: 'dev_new_1', pid: 'hussein', endpoint: 'https://push/new' },
              ],
            }),
          };
        },
        async set(val) { savedRegistry = val; },
      };
    },
  };
  const okRetire = await sandbox.retireOldPushDevice(okDb);
  assert.equal(okRetire, true);
  assert.equal(savedRegistry.items.length, 1);
  assert.equal(savedRegistry.items[0].id, 'dev_new_1');
  assert.equal(JSON.parse(ls.getItem('ubp.migrated_from')).pushRetired, true);

  // Ensure retireOldPushDevice preserves needsPushPrompt=false if user dismissed while in-flight
  const curMf = JSON.parse(ls.getItem('ubp.migrated_from'));
  curMf.pushRetired = false;
  curMf.needsPushPrompt = false;
  ls.setItem('ubp.migrated_from', JSON.stringify(curMf));
  await sandbox.retireOldPushDevice(okDb);
  assert.equal(JSON.parse(ls.getItem('ubp.migrated_from')).needsPushPrompt, false, 'dismissed banner must not resurrect');
  assert.equal(JSON.parse(ls.getItem('ubp.migrated_from')).pushRetired, true);

  // Restore prompt for banner visibility checks: !state.profile must NOT emit dead data-act="pushon"
  ls.setItem('ubp.migrated_from', JSON.stringify(Object.assign({}, JSON.parse(ls.getItem('ubp.migrated_from')), { needsPushPrompt: true })));
  vm.runInContext('state.profile = null;', ctx);
  const loginBanner = sandbox.renderMigrationCard();
  assert.ok(loginBanner.includes('Moved to Cloudflare'));
  assert.ok(!loginBanner.includes('data-act="pushon"'), 'no dead pushon button on login screen');
  vm.runInContext('state.profile = "hussein";', ctx);
  assert.ok(sandbox.renderMigrationCard().includes('data-act="pushon"'), 'pushon active once profile opened');

  // Old github.io builder: test flush + replayPending + 180k cap
  let replayCalled = false;
  sandbox.location.hostname = 'husseinbdeir.github.io';
  assert.ok(sandbox.renderMigrationCard().includes('Move to Cloudflare App'));
  vm.runInContext('state.db = { _http: true };', ctx);
  sandbox.replayPending = async () => { replayCalled = true; };
  ls.setItem('ubp.hussein.sessions', JSON.stringify(Array.from({ length: 1200 }, (_, i) => ({
    id: `big_${i}`, date: '2026-11-01', notes: 'x'.repeat(220),
  }))));
  const builtUrl = await sandbox.buildFitnessMigrationUrl();
  assert.equal(replayCalled, true, 'buildFitnessMigrationUrl must call replayPending');
  assert.ok(builtUrl.startsWith('https://fitness.husseinbdeir.workers.dev/#migrate='));
  assert.ok(builtUrl.length < 200000, 'payload must stay under size cap when sessions are huge');

  // Cloudflare worker unit test
  const workerMod = await import(pathToFileURL(path.join(ROOT, 'cloudflare', 'worker.js')).href);
  const env = {
    ASSETS: {
      async fetch(req) {
        const u = new URL(req.url);
        return new Response(`asset:${u.pathname}`, { status: 200 });
      },
    },
  };
  const rRoot = await workerMod.default.fetch(new Request('https://fitness.husseinbdeir.workers.dev/'), env);
  assert.equal(rRoot.status, 200);
  assert.equal(await rRoot.text(), 'asset:/index.html');
  assert.equal(rRoot.headers.get('cache-control'), 'no-cache');

  for (const blocked of ['/scripts/deploy_cf.mjs', '/cloudflare/worker.js', '/wrangler.toml', '/.git/HEAD', '/README.md']) {
    const rb = await workerMod.default.fetch(new Request(`https://fitness.husseinbdeir.workers.dev${blocked}`), env);
    assert.equal(rb.status, 404, `expected 404 for ${blocked}`);
  }
  const rPost = await workerMod.default.fetch(new Request('https://fitness.husseinbdeir.workers.dev/', { method: 'POST' }), env);
  assert.equal(rPost.status, 405);
  const rSc = await workerMod.default.fetch(new Request('https://fitness.husseinbdeir.workers.dev/Sync-Apple-Health.shortcut'), env);
  assert.equal(rSc.status, 200);
  assert.equal(rSc.headers.get('content-disposition'), 'attachment; filename="Sync-Apple-Health.shortcut"');
  assert.equal(rSc.headers.get('cache-control'), 'no-cache');

  console.log('verify_fitness_migration: ALL PASS');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
