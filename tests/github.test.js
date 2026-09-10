import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchSnapshot, auditRepository } from '../lib/github.js';
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });
function mock({ privateRepo = false, truncated = false, count = 1 } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/sample/project')) return json({ full_name: 'sample/project', default_branch: 'feat/main', private: privateRepo });
    if (url.endsWith('/commits/feat%2Fmain')) return json({ sha: 'commit123', commit: { tree: { sha: 'tree123' } } });
    if (url.endsWith('/git/trees/tree123?recursive=1')) return json({ truncated, tree: Array.from({ length: count }, (_, i) => ({ path: i ? `pkg${i}/README.md` : 'README.md', type: 'blob', mode: '100644', sha: `blob${i}`, size: 20 })) });
    if (url.includes('/git/blobs/')) return json({ content: Buffer.from('[坏链接](missing.md)').toString('base64'), size: 20, encoding: 'base64' });
    throw new Error('Unexpected URL');
  };
  return { calls, fetchImpl };
}
test('固定提交读取真实 blob，认证只发送至 GitHub API', async () => {
  const { fetchImpl, calls } = mock();
  const result = await auditRepository('sample/project', { fetchImpl, token: 'test-token' });
  assert.equal(result.commit, 'commit123');
  assert.equal(result.summary.errors, 1);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(call => call.url.startsWith('https://api.github.com/repos/sample/project')));
  assert.ok(calls.every(call => call.options.headers.Authorization === 'Bearer test-token'));
});
test('私有仓库拒绝读取内容', async () => {
  const { fetchImpl, calls } = mock({ privateRepo: true });
  await assert.rejects(fetchSnapshot('sample/project', { fetchImpl }), /只检查公开/);
  assert.equal(calls.length, 1);
});
test('截断目录中止检查，避免假缺失', async () => {
  const { fetchImpl, calls } = mock({ truncated: true });
  await assert.rejects(fetchSnapshot('sample/project', { fetchImpl }), /完整返回范围/);
  assert.equal(calls.length, 3);
});
test('限制读取文件数量并记录未读取内容', async () => {
  const { fetchImpl, calls } = mock({ count: 23 });
  const snapshot = await fetchSnapshot('sample/project', { fetchImpl });
  assert.equal(calls.length, 23);
  assert.equal(Object.keys(snapshot.documents).length, 20);
  assert.equal(snapshot.skipped.length, 3);
});
test('限流、空仓库、错误令牌和网络故障给出可操作反馈', async () => {
  for (const [status, pattern] of [[403, /限制/], [404, /找不到/], [409, /空仓库/], [401, /TOKEN/], [500, /暂时/]]) {
    await assert.rejects(fetchSnapshot('sample/project', { fetchImpl: async () => json({}, status) }), pattern);
  }
  await assert.rejects(fetchSnapshot('sample/project', { fetchImpl: async () => { throw new Error('secret detail'); } }), /无法连接/);
});
