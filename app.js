'use strict';
const $ = selector => document.querySelector(selector);
let report = null;
let filter = 'all';
let busy = false;
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function renderFindings() {
  const items = report.findings.filter(item => filter === 'all' || item.severity === filter);
  $('#findings').replaceChildren();
  for (const item of items) {
    const card = element('article', undefined, `finding ${item.severity}`);
    const top = element('div', undefined, 'finding-top');
    top.append(element('span', item.severity === 'error' ? '问题' : '待确认', 'badge'), element('h3', item.title));
    const source = element('a', item.file ? `${item.file}${item.line ? `:${item.line}` : ''} ↗` : '查看仓库 ↗');
    source.href = item.url;
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    card.append(top, source, element('pre', item.evidence, 'evidence'), element('p', item.suggestion, 'suggestion'));
    $('#findings').append(card);
  }
  $('#finding-count').textContent = `${items.length} 条`;
  $('#no-findings').hidden = items.length > 0;
  $('#no-findings').textContent = report.findings.length ? '当前分类没有结果。' : report.summary.checks === 0 ? '没有可执行的规则检查。请查看右侧范围说明，不能据此判断仓库没有问题。' : '本次检查范围内未发现问题。请结合覆盖范围和跳过项确认，实际运行仍需验证。';
  document.querySelectorAll('[data-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === filter)));
}
function renderReport() {
  $('#repo-name').textContent = report.repository;
  const timestamp = new Date(report.checkedAt).toLocaleString('zh-CN', { hour12: false });
  $('#snapshot').textContent = `${report.branch} · ${report.commit.slice(0, 7)} · ${timestamp}${report.cached ? ' · 两分钟内缓存' : ''}`;
  for (const name of ['errors', 'warnings', 'checks']) $(`#${name}`).textContent = report.summary[name];
  const coverage = report.coverage;
  const labels = [`${coverage.documents.length} 份 README · ${coverage.manifests.length} 份依赖清单`, `${coverage.links} 次本地链接检查`, `${coverage.commands} 次命令文件检查`, `${coverage.configuration} 次配置检查`, `${coverage.externalLinks} 个外部链接、${coverage.anchorLinks} 个纯锚点未检查`];
  $('#coverage-list').replaceChildren(...labels.map(text => element('li', text)));
  $('#skipped-summary').textContent = `未检查的内容${coverage.skipped.length ? ` · ${coverage.skipped.length} 个跳过项` : ''}`;
  $('#skipped-list').replaceChildren(...coverage.skipped.map(text => element('li', text)));
  renderFindings();
  $('#report').hidden = false;
  $('#before').hidden = true;
}
async function run() {
  if (busy) return;
  const repository = $('#repository').value.trim();
  if (!repository) { $('#repository').focus(); return; }
  busy = true;
  $('#submit').disabled = true;
  $('#example').disabled = true;
  $('#submit').textContent = '检查中…';
  $('#report').hidden = true;
  $('#error').hidden = true;
  $('#status').textContent = '正在读取默认分支、README 和配置文件。通常需要几秒钟，大型仓库可能更久。';
  $('#audit-form').setAttribute('aria-busy', 'true');
  try {
    const response = await fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repository }), signal: AbortSignal.timeout(65_000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '检查未完成，请重试。');
    report = data;
    filter = 'all';
    renderReport();
    $('#status').textContent = `检查完成：${report.summary.errors} 个问题，${report.summary.warnings} 个待确认项。`;
  } catch (error) {
    $('#status').textContent = '';
    $('#error').textContent = error.name === 'TimeoutError' ? '检查超时，请稍后重试。' : error instanceof TypeError ? '无法连接本地服务，请确认 npm start 仍在运行。' : error.message;
    $('#error').hidden = false;
  } finally {
    busy = false;
    $('#submit').disabled = false;
    $('#example').disabled = false;
    $('#submit').textContent = '开始检查 →';
    $('#audit-form').setAttribute('aria-busy', 'false');
  }
}
$('#audit-form').addEventListener('submit', event => { event.preventDefault(); run(); });
$('#example').addEventListener('click', () => { $('#repository').value = 'liiiyiiixiii/one'; run(); });
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { filter = button.dataset.filter; if (report) renderFindings(); }));
$('#download').addEventListener('click', () => {
  if (!report) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const anchor = element('a');
  anchor.href = url;
  anchor.download = `one-${report.repository.replace('/', '-')}-${report.commit.slice(0, 7)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
