import test from 'node:test';
import assert from 'node:assert/strict';
import { auditSnapshot, parseRepository, reportMarkdown } from '../lib/audit.js';

function snapshot(readme, files = {}, extra = {}) {
  const documents = { 'README.md': readme };
  const all = { ...documents, ...files };
  const entries = Object.keys(all).map(path => ({ path, type: 'blob', mode: '100644' }));
  for (const file of Object.keys(all)) {
    const segments = file.split('/'); segments.pop();
    while (segments.length) { const path = segments.join('/'); if (!entries.some(e => e.path === path)) entries.push({ path, type: 'tree' }); segments.pop(); }
  }
  return { repository: 'sample/project', branch: 'main', commit: 'a'.repeat(40), documents, entries, manifests: Object.fromEntries(Object.entries(files).filter(([file]) => file.endsWith('package.json'))), ...extra };
}
const rules = report => report.findings.map(item => item.rule);

test('接受仓库首页与 owner/repo，拒绝非 GitHub、嵌套地址和注入', () => {
  assert.equal(parseRepository(' https://github.com/sample/project.git/ '), 'sample/project');
  assert.equal(parseRepository('sample/project'), 'sample/project');
  for (const input of ['', '../x', 'sample/..', 'sample/project/tree/main', 'https://evil.test/a/b', 'https://github.com@evil.test/a/b', 'https://github.com/a/b?x=y', 'https://github.com:99/a/b', 'sample/project;curl', null]) assert.throws(() => parseRepository(input));
});
test('本地链接、图片、URL 编码和引用式链接定位到正确行', () => {
  const report = auditSnapshot(snapshot('# Demo\n[有效](docs/guide.md)\n![图片](assets/missing.png)\n[空格](docs/my%20guide.md)\n[文档][guide]\n[guide]: docs/missing.md', { 'docs/guide.md': '', 'docs/my guide.md': '' }));
  assert.equal(report.coverage.links, 4);
  assert.deepEqual(report.findings.map(f => f.line), [3, 5]);
  assert.equal(report.findings[0].url, `https://github.com/sample/project/blob/${'a'.repeat(40)}/README.md#L3`);
});
test('忽略代码中的链接、外部网址和纯锚点', () => {
  const report = auditSnapshot(snapshot('`[示例](missing)`\n```md\n[示例](missing)\n```\n[网站](https://example.com)\n[标题](#intro)'));
  assert.equal(report.findings.length, 0);
  assert.equal(report.coverage.externalLinks, 1);
  assert.equal(report.coverage.anchorLinks, 1);
});
test('子目录、绝对仓库路径和括号文件名按文件所在目录解析', () => {
  const report = auditSnapshot(snapshot('', { 'docs/README.md': '', 'docs/a(b).md': '', 'root.md': '' }, { documents: { 'docs/README.md': '[a](a(b).md)\n[b](/root.md)\n[c](../root.md)' } }));
  assert.equal(report.coverage.links, 3);
  assert.equal(report.findings.length, 0);
});
test('不存在的引用定义给出问题', () => {
  assert.ok(rules(auditSnapshot(snapshot('[说明][unknown]'))).includes('link-reference-undefined'));
});
test('核对 scripts 与 npm ci 锁文件，不把缺失脚本判通过', () => {
  const report = auditSnapshot(snapshot('```sh\nnpm run start\nnpm ci\n```', { 'package.json': '{"scripts":{"dev":"node app.js"}}' }));
  assert.deepEqual(rules(report), ['npm-script-missing', 'npm-lock-missing']);
  assert.equal(report.findings[0].line, 2);
});
test('npm start 默认 server.js 可用，但 npm test 不存在则报错', () => {
  const report = auditSnapshot(snapshot('```sh\nnpm start\nnpm test\n```', { 'package.json': '{}', 'server.js': '' }));
  assert.deepEqual(rules(report), ['npm-script-missing']);
  assert.match(report.findings[0].title, /test/);
});
test('cd 与 && 使用正确的子包目录', () => {
  const report = auditSnapshot(snapshot('```bash\ncd app && npm run dev\n```', { 'app/package.json': '{"scripts":{"dev":"node index.js"}}' }));
  assert.equal(report.findings.length, 0);
  assert.equal(report.coverage.commands, 1);
});
test('clone 后进入仓库目录从根路径开始', () => {
  const report = auditSnapshot(snapshot('```sh\ngit clone https://github.com/sample/project.git\ncd project\nnpm run dev\n```', { 'package.json': '{"scripts":{"dev":"node app.js"}}' }));
  assert.equal(report.findings.length, 0);
});
test('复杂 shell、工作区参数、动态路径和未知目录不误报缺文件', () => {
  const report = auditSnapshot(snapshot('```sh\nnpm --prefix app run dev\nnode $ENTRY\ncd /tmp/output\nnode generated.js\ncd app; npm start\nnode other.js\n```'));
  assert.equal(report.findings.length, 0);
  assert.ok(report.coverage.skipped.length >= 3);
});
test('配置复制来源和生成后的文件按顺序检查', () => {
  const report = auditSnapshot(snapshot('```sh\ncp starter.js app.js\nnode app.js\ncp .env.example .env\n```', { 'starter.js': '' }));
  assert.ok(report.findings.some(f => f.rule === 'configuration-missing-file' && f.line === 4));
  assert.ok(!report.findings.some(f => f.evidence === 'node app.js'));
});
test('检查 Python requirements 和脚本', () => {
  const report = auditSnapshot(snapshot('```bash\npython3 -m pip install -r requirements.txt\npython3 run.py\n```'));
  assert.equal(report.findings.length, 2);
  assert.match(report.findings[0].title, /requirements.txt/);
});
test('环境示例缺失只列待确认，存在样例时不报告', () => {
  assert.equal(auditSnapshot(snapshot('复制 `.env` 后填写配置。')).findings[0].severity, 'warning');
  assert.equal(auditSnapshot(snapshot('复制 `.env` 后填写配置。', { '.env.example': 'PORT=3000' })).findings.length, 0);
});
test('clone 后直接进入子目录，配置示例可位于其他目录', () => {
  const data = snapshot('```bash\ngit clone https://github.com/sample/project.git\ncd project/backend\npython -m pip install -r requirements.txt\ncp .env.example .env\n```', { 'backend/requirements.txt': '', 'backend/.env.example': '' });
  const report = auditSnapshot(data);
  assert.equal(report.findings.length, 0);
  assert.equal(report.coverage.commands, 1);
  assert.equal(report.coverage.configuration, 2);
  data.documents = { 'deploy/README.md': '复制 `backend/.env.example` 到 `.env`。' };
  assert.equal(auditSnapshot(data).findings.length, 0);
  assert.equal(auditSnapshot(snapshot('这里提到 `.env.example`，但未要求使用环境文件。')).findings.length, 0);
  assert.equal(auditSnapshot(snapshot('这个工具会检查 `.env` 是否提供配置示例。')).findings.length, 0);
});
test('无有效清单、符号链接、子模块和仓库外路径显式列为跳过', () => {
  const data = snapshot('[链接](linked/file.md)\n[模块](module/README.md)\n[外部](../outside)\n```sh\nnpm run dev\n```', { 'package.json': '{}' });
  data.manifests = {};
  data.entries.push({ path: 'linked', type: 'blob', mode: '120000' }, { path: 'module', type: 'commit', mode: '160000' });
  const report = auditSnapshot(data);
  assert.equal(report.findings.length, 0);
  assert.equal(report.coverage.skipped.length, 4);
});
test('损坏清单、缺少入口 README 和零覆盖均不伪造通过', () => {
  const report = auditSnapshot(snapshot('', { 'package.json': 'not json' }, { documents: {}, entries: [{ path: 'package.json', type: 'blob' }] }));
  assert.deepEqual(rules(report), ['readme-missing', 'package-invalid']);
  assert.equal(report.summary.checks, 0);
  assert.match(reportMarkdown(report), /静态检查/);
});
