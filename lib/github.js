import { parseRepository, auditSnapshot } from './audit.js';

export class AuditError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}
const MAX_FILES = 20;
const MAX_BYTES = 180_000;
const excluded = /(?:^|\/)(?:node_modules|vendor|dist|build|\.git|\.venv)\//;
export async function fetchSnapshot(input, { fetchImpl = fetch, token = process.env.GITHUB_TOKEN, signal = AbortSignal.timeout(60_000) } = {}) {
  let repository;
  try { repository = parseRepository(input); } catch (error) { throw new AuditError(error.message, 400); }
  const base = `https://api.github.com/repos/${repository}`;
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'one-repo-check' };
  if (token) headers.Authorization = `Bearer ${token}`;
  async function request(route) {
    let response;
    try { response = await fetchImpl(`${base}${route}`, { headers, signal, redirect: 'error' }); }
    catch (error) {
      if (['UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(error.cause?.code)) throw new AuditError('Node.js 无法验证 GitHub 的 HTTPS 证书。请通过 NODE_EXTRA_CA_CERTS 配置可信 CA 文件后重启，不要关闭证书验证。');
      throw new AuditError(signal.aborted ? '检查超时，请稍后重试或选择较小的仓库。' : '无法连接 GitHub，请检查网络后重试。', signal.aborted ? 504 : 502);
    }
    if (!response.ok) {
      if (response.status === 404) throw new AuditError('找不到该公开仓库或所需文件，请确认仓库地址。', 404);
      if (response.status === 409) throw new AuditError('这是一个空仓库，还没有可检查的提交。', 422);
      if (response.status === 401) throw new AuditError('服务端 GITHUB_TOKEN 无效，请更新或移除后重试。', 401);
      if ([403, 429].includes(response.status)) {
        const reset = Number(response.headers.get('x-ratelimit-reset'));
        const when = reset > 0 ? `，可在 ${new Date(reset * 1000).toISOString()} 后重试` : '，请稍后重试';
        throw new AuditError(`GitHub 限制了本次请求${when}。本地运行时可设置 GITHUB_TOKEN 提高可用额度。`, 429);
      }
      throw new AuditError(`GitHub 暂时无法返回数据（${response.status}），请稍后重试。`);
    }
    try { return await response.json(); } catch { throw new AuditError('GitHub 返回的数据不完整，请重新检查。'); }
  }
  const repo = await request('');
  if (repo.private) throw new AuditError('当前版本只检查公开仓库。', 400);
  const head = await request(`/commits/${encodeURIComponent(repo.default_branch)}`);
  const tree = await request(`/git/trees/${head.commit.tree.sha}?recursive=1`);
  if (tree.truncated) throw new AuditError('仓库目录超过 GitHub 的完整返回范围，本次未检查，避免误报缺失文件。', 422);
  const entries = tree.tree;
  const candidates = entries.filter(entry => entry.type === 'blob' && entry.mode !== '120000' && !excluded.test(entry.path) && /(?:^|\/)(?:readme(?:\.[^/]+)?\.(?:md|markdown)|readme\.(?:md|markdown)|package\.json)$/i.test(entry.path));
  candidates.sort((a, b) => {
    const rank = item => (/^readme\.(md|markdown)$/i.test(item.path) ? -100 : item.path === 'package.json' ? -80 : /readme/i.test(item.path) ? -20 : 0) + item.path.split('/').length;
    return rank(a) - rank(b) || a.path.localeCompare(b.path);
  });
  const documents = {};
  const manifests = {};
  const skipped = [];
  let readCount = 0;
  // Sequential requests keep rate use predictable and stop immediately on quota/network failure.
  for (const entry of candidates) {
    if (readCount >= MAX_FILES || entry.size > MAX_BYTES) {
      skipped.push(`${entry.path}：超过单次 ${MAX_FILES} 个文件或单文件 ${MAX_BYTES / 1000} KB 的读取上限。`); continue;
    }
    readCount++;
    const blob = await request(`/git/blobs/${entry.sha}`);
    if (blob.encoding !== 'base64' || blob.size > MAX_BYTES) { skipped.push(`${entry.path}：编码或大小不支持。`); continue; }
    const content = Buffer.from(blob.content, 'base64').toString('utf8');
    if (entry.path.endsWith('package.json')) manifests[entry.path] = content;
    else documents[entry.path] = content;
  }
  for (const entry of entries.filter(entry => /(?:^|\/)readme(?:\.(?:rst|txt))?$/i.test(entry.path))) skipped.push(`${entry.path}：当前只解析 Markdown README。`);
  return { repository: repo.full_name, branch: repo.default_branch, commit: head.sha, entries, documents, manifests, skipped };
}
export async function auditRepository(input, options) { return auditSnapshot(await fetchSnapshot(input, options)); }
