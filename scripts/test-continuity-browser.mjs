// Isolated browser smoke: in-memory DB, local GitHub stub, real compiled Go API and production UI.
// Run npm run build first; supply PLAYWRIGHT_MODULE if Playwright is installed outside this repo.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = 'http://127.0.0.1:4178';
const children = [];
let browser;
let head = 'a'.repeat(40);
const upstream = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/repos/solo/demo') return res.end(JSON.stringify({id: 4242, full_name: 'solo/demo', default_branch: 'main', private: false, visibility: 'public'}));
  if (req.url.startsWith('/repos/solo/demo/commits?')) return res.end(JSON.stringify([{sha: head, commit: {message: 'Initial demo', author: {name: 'Demo Dev', date: '2026-01-01T00:00:00Z'}}}]));
  res.writeHead(404).end('{}');
});
function launch(cmd, args, env = {}) {
  const child = spawn(cmd, args, {cwd: root, env: {...process.env, ...env}, stdio: ['ignore', 'pipe', 'pipe']});
  children.push(child); return child;
}
async function ready(child, text) {
  await new Promise((resolve, reject) => {
    let log = ''; const timer = setTimeout(() => reject(Error(`Timed out waiting for ${text}: ${log}`)), 20000);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', b => {log += b; if (log.includes(text)) {clearTimeout(timer);resolve();}});
    child.once('exit', code => {clearTimeout(timer);reject(Error(`Process exited ${code}: ${log}`));});
  });
}
async function json(url, body, headers = {}) {
  const res = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json', ...headers}, body: JSON.stringify(body)});
  assert.equal(res.status, body.email ? 201 : 200, `HTTP failure at ${url}`); return res.json();
}
try {
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  await ready(launch('node', ['scripts/pglite-server.mjs', '54358', 'memory']), 'PGLITE_READY');
  const env = {NODE_ENV: 'test', PORT: '4178', DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54358/postgres?sslmode=disable&connection_limit=1', SESSION_SECRET: 'local-test-only-session-secret-32-chars', SESSION_COOKIE_SECURE: 'false', CORS_ORIGINS: base, AUTO_MIGRATE: 'true', GITHUB_API_BASE_URL: `http://127.0.0.1:${upstream.address().port}`, STATIC_FILES_DIR: path.join(root, 'apps/web/dist')};
  await ready(launch(path.join(root, 'apps/api-go/bin/server'), [], env), 'API listening');
  const email = 'browser-demo@unpause.test', password = 'LocalDemoPassword123!';
  await json(`${base}/api/v1/auth/register`, {email, password});
  const demo = launch('node', ['scripts/create-continuity-demo.mjs'], {UNPAUSE_BASE_URL: `${base}/api/v1`, UNPAUSE_EMAIL: email, UNPAUSE_PASSWORD: password});
  let output = ''; demo.stdout.on('data', b => output += b); let errors = '';demo.stderr.on('data', b => errors += b);
  const [code] = await once(demo, 'exit'); assert.equal(code, 0, errors);
  const resumePath = output.match(/\/projects\/[\w-]+\/resume/)[0];
  browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? {executablePath: process.env.CHROMIUM_EXECUTABLE} : {})});
  const page = await browser.newPage({viewport: {width: 1440, height: 1050}});
  const browserErrors = []; page.on('pageerror', e => browserErrors.push(e.message));
  await page.goto(`${base}/login`);
  await page.getByLabel('Email Address').fill(email); await page.getByLabel('Password', {exact: true}).fill(password);
  await page.getByRole('button', {name: 'Sign In', exact: true}).click(); await page.waitForURL('**/projects');
  await page.getByRole('button', {name:'Open my demo',exact:true}).click();
  await page.waitForURL('**/resume');
  await page.getByText('Unpause Demo',{exact:true}).first().waitFor();
  const myDemoURL=page.url();
  await page.getByRole('link',{name:'Projects',exact:true}).click();await page.waitForURL('**/projects');
  await page.getByRole('button',{name:'Open my demo',exact:true}).click();await page.waitForURL(myDemoURL);
  await page.goto(base + resumePath);
  await page.getByLabel('Public GitHub repository URL').fill('https://github.com/solo/demo');
  await page.getByRole('button', {name: 'Connect GitHub repository', exact: true}).click();
  const secret = await page.getByLabel('UNPAUSE_SECRET', {exact: true}).inputValue();
  assert.equal(secret.length, 64); await page.getByRole('button', {name: 'Done', exact: true}).click();
  await page.getByText('1 unread updates', {exact: true}).waitFor();
  const endpoint = await page.getByLabel('Delivery endpoint (requires HTTPS in GitHub)').inputValue();
  const started = performance.now(); head = 'b'.repeat(40);
  await json(endpoint, {deliveryId: 'actions:smoke', repositoryId: 4242, branch: 'main', eventAt: new Date().toISOString(), incomplete: false, commits: [{sha: head, message: 'Verify expired sessions', author: 'Demo Dev', eventAt: new Date().toISOString()}]}, {Authorization: 'Bearer ' + secret});
  const stored = performance.now();
  await page.getByRole('link', {name: 'bbbbbbb', exact: true}).waitFor({timeout: 30000});
  const visible = performance.now();
  await page.reload(); await page.getByText('2 unread updates', {exact: true}).waitFor();
  await page.getByRole('button', {name: 'Mark all updates as reviewed', exact: true}).click(); await page.getByRole('button', {name: 'Confirm review all', exact: true}).click(); await page.getByText('0 unread updates', {exact: true}).waitFor();
  await page.getByRole('button', {name: 'Edit return context', exact: true}).click();
  await page.getByLabel('Return note', {exact: true}).fill('Next: verify expired sessions after the new push.');
  await page.getByRole('button', {name: 'Save return context', exact: true}).click(); await page.getByText('Next: verify expired sessions after the new push.', {exact: true}).waitFor();
  await page.getByRole('button', {name: 'Manage connection / workflow setup'}).click();
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', {name: 'Download workflow'}).click(); const download = await downloadPromise; assert.equal(download.suggestedFilename(), 'unpause.yml');
  await page.getByRole('button',{name:'Pause work',exact:true}).click();
  await page.getByLabel('Where I stopped',{exact:false}).fill('Compact commit view implemented');
  await page.getByLabel('Blockers (optional)',{exact:true}).fill('Need mobile verification');
  await page.getByLabel('Next action when I return',{exact:false}).fill('Check links and continue safely');
  await page.getByRole('button',{name:'Save pause note',exact:true}).click();
  await page.getByText('Pause note saved. You can return to it next time.',{exact:true}).waitFor();
  await page.reload();await page.getByText(/Where I stopped: Compact commit view implemented/).waitFor();
  await page.getByText('0 unread updates',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Commit details',exact:true}).first().click();
  await page.getByRole('button',{name:'Link issue / decision',exact:true}).first().click();
  await page.getByLabel('Linked issue',{exact:true}).click();
  await page.getByRole('option',{name:'Verify expired sessions',exact:true}).click();
  await page.getByLabel('Linked decision',{exact:true}).click();
  await page.getByRole('option',{name:'Use server-side cookie sessions',exact:true}).click();
  await page.getByRole('button',{name:'Save links',exact:true}).click();
  await page.getByRole('link',{name:'Issue: Verify expired sessions',exact:true}).waitFor();
  await page.reload();await page.getByRole('link',{name:'Decision: Use server-side cookie sessions',exact:true}).waitFor();
  const many=Array.from({length:12},(_,i)=>({sha:(100+i).toString(16).padStart(7,'0')+'c'.repeat(33),message:'Compact history '+i+'\nLong detail remains expandable',author:'Demo Dev',eventAt:new Date(Date.now()-12000+i*1000).toISOString()}));
  await json(endpoint,{deliveryId:'actions:compact-preview',repositoryId:4242,branch:'main',eventAt:new Date().toISOString(),incomplete:false,commits:many},{Authorization:'Bearer '+secret});
  await page.getByRole('link',{name:many[11].sha.slice(0,7),exact:true}).first().waitFor({timeout:30000});
  await page.waitForFunction(()=>document.querySelectorAll('[data-testid="commit-row"]').length===5);
  await page.getByRole('button',{name:'Show 5 more commits',exact:true}).click();assert.equal(await page.getByTestId('commit-row').count(),10);
  await page.getByText('1 unread updates',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Show latest 5',exact:true}).click();assert.equal(await page.getByTestId('commit-row').count(),5);
  const screenshots = process.env.CONTINUITY_SCREENSHOT_DIR || '/tmp/unpause-continuity-screenshots'; await mkdir(screenshots, {recursive: true});
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path: path.join(screenshots, 'desktop.png'), fullPage: true});
  await page.setViewportSize({width: 390, height: 844}); await page.evaluate(()=>window.scrollTo(0,0)); await page.screenshot({path: path.join(screenshots, 'mobile.png'), fullPage: true});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'Mobile horizontal overflow');
  assert.deepEqual(browserErrors, []);
  console.log(JSON.stringify({status: 'passed', environment: 'local mock GitHub + in-memory PostgreSQL + compiled Go + production React', requestToStoredMs: Math.round(stored-started), storedToVisibleMs: Math.round(visible-stored), verified: ['demo setup', 'idempotent private demo from UI', 'pause handoff persists', 'commit links persist', 'five-commit preview and expansion preserves unread', 'login', 'repository setup', 'one-time secret', 'automatic visible-page polling', 'unread persistence on reload', 'explicit review', 'return note', 'workflow download', 'desktop/mobile overflow', 'no browser errors'], screenshots}, null, 2));
} finally {
  if (browser) await browser.close(); upstream.close();
  for (const child of children.reverse()) {if (child.exitCode === null) child.kill('SIGTERM');}
}
