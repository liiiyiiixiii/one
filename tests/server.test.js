import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';
async function setup(t, audit) {
  const server = createServer({ audit });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  return (route, options) => fetch(base + route, options);
}
const post = value => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
test('HTTP 入口、报告缓存、输入错误和静态文件边界', async t => {
  let calls = 0;
  const request = await setup(t, async repository => { calls++; return { repository, findings: [] }; });
  const page = await request('/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /仓库体检/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  for (const route of ['/.env', '/package.json', '/lib/github.js', '/.git/config']) assert.equal((await request(route)).status, 404);
  assert.equal((await request('/api/audit')).status, 405);
  assert.equal((await request('/api/audit', post(null))).status, 400);
  assert.equal((await request('/api/audit', { ...post({}), body: '{bad' })).status, 400);
  assert.equal((await request('/api/audit', post({ repository: 'x'.repeat(3000) }))).status, 413);
  assert.equal((await request('/api/audit', { ...post({ repository: 'sample/project' }), headers: { 'Content-Type': 'application/json', Origin: 'https://evil.test' } })).status, 403);
  const first = await (await request('/api/audit', post({ repository: 'sample/project' }))).json();
  const second = await (await request('/api/audit', post({ repository: 'sample/project' }))).json();
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(calls, 1);
});
test('检查失败后能够继续接收任务，不暴露内部错误', async t => {
  let calls = 0;
  const request = await setup(t, async () => { if (++calls === 1) throw new Error('private-token'); return { findings: [] }; });
  const first = await request('/api/audit', post({ repository: 'sample/project' }));
  assert.equal(first.status, 500);
  assert.doesNotMatch(await first.text(), /private-token/);
  assert.equal((await request('/api/audit', post({ repository: 'sample/project' }))).status, 200);
});
