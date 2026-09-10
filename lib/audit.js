import path from 'node:path/posix';

export function parseRepository(value) {
  if (typeof value !== 'string') throw new Error('请输入 GitHub 仓库地址或 owner/repo。');
  let input = value.trim();
  if (input.startsWith('https://')) {
    let url;
    try { url = new URL(input); } catch { throw new Error('仓库地址格式不正确。'); }
    if (url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash) {
      throw new Error('只支持 https://github.com/owner/repo 形式的公开仓库地址。');
    }
    input = url.pathname.replace(/^\//, '').replace(/\/$/, '');
  }
  input = input.replace(/\.git$/, '');
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/.test(input) || ['.', '..'].includes(input.split('/')[1])) {
    throw new Error('请输入 owner/repo，或仓库首页的 GitHub 地址。');
  }
  return input;
}

const resolve = (base, target) => path.normalize(path.join(target.startsWith('/') ? '.' : base, target.replace(/^\//, '')));
const dynamic = value => /[$*{}<>`~\\]/.test(value);
const sampleName = /(?:^|\/)(?:\.env(?:\.(?:example|sample|template))|(?:example|sample)\.env)$/i;

export function auditSnapshot(snapshot) {
  const { repository, commit, entries, documents, manifests, skipped = [] } = snapshot;
  const paths = new Set(entries.map(entry => entry.path));
  const special = entries.filter(entry => entry.mode === '120000' || entry.type === 'commit').map(entry => entry.path);
  const findings = [];
  const checks = { links: 0, commands: 0, configuration: 0 };
  const limitations = [...skipped];
  let externalLinks = 0;
  let anchorLinks = 0;
  const sourceUrl = (file, line) => `https://github.com/${repository}/blob/${commit}/${file.split('/').map(encodeURIComponent).join('/')}${line ? `#L${line}` : ''}`;
  function issue(rule, severity, title, file, line, evidence, suggestion) {
    findings.push({ rule, severity, title, file, line, evidence, suggestion, url: file ? sourceUrl(file, line) : `https://github.com/${repository}/tree/${commit}` });
  }
  function checkFile(target, file, line, evidence, category, generated = new Set()) {
    if (dynamic(target) || target.startsWith('../') || special.some(item => target === item || target.startsWith(`${item}/`))) {
      limitations.push(`${file}:${line}：路径 ${target} 含动态内容、位于仓库外或经过符号链接/子模块，未检查。`);
      return;
    }
    checks[category]++;
    if (!paths.has(target) && !generated.has(target) && target !== '.') {
      issue(`${category}-missing-file`, 'error', `找不到 ${target}`, file, line, evidence, `将引用改为仓库中实际存在的路径；如果文件需要生成，请在这条指令之前说明生成步骤。`);
    }
  }
  if (!entries.some(entry => /^(?:\.github\/|docs\/)?readme(?:\.(?:md|markdown|rst|txt))?$/i.test(entry.path))) {
    issue('readme-missing', 'warning', '缺少仓库入口 README', '', null, '根目录、.github 和 docs 中没有找到 README。', '补充项目用途、运行方法和必要配置。');
  }
  const parsedManifests = new Map();
  for (const [file, content] of Object.entries(manifests)) {
    try { const data = JSON.parse(content); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); parsedManifests.set(file, data); }
    catch { issue('package-invalid', 'error', 'package.json 不是有效的 JSON 对象', file, 1, '无法解析依赖清单。', '修正 JSON 格式后重新检查。'); }
  }
  for (const [file, content] of Object.entries(documents)) {
    const lines = content.split(/\r?\n/);
    const definitions = new Map();
    let definitionFence = null;
    for (const text of lines) {
      const delimiter = text.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (delimiter) { if (!definitionFence) definitionFence = delimiter[1][0]; else if (definitionFence === delimiter[1][0]) definitionFence = null; continue; }
      if (!definitionFence) {
        const match = text.match(/^\s{0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/);
        if (match) definitions.set(match[1].trim().toLowerCase(), match[2] || match[3]);
      }
    }
    let fence = null;
    let shell = false;
    let cwd = path.dirname(file);
    let cwdKnown = true;
    let generated = new Set();
    for (let index = 0; index < lines.length; index++) {
      const text = lines[index];
      const line = index + 1;
      const boundary = text.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
      if (boundary) {
        if (!fence) {
          fence = boundary[1];
          const language = boundary[2].trim().toLowerCase();
          shell = /^(?:sh|bash|shell|console|zsh|shellscript|)$/.test(language);
          cwd = path.dirname(file); cwdKnown = true; generated = new Set();
        } else if (boundary[1][0] === fence[0] && boundary[1].length >= fence.length && !boundary[2].trim()) fence = null;
        continue;
      }
      if (!fence) {
        const plain = text.replace(/`+[^`]*`+/g, '');
        const targets = [];
        // Deliberately limited Markdown syntax: inline and full/collapsed reference links.
        for (const match of plain.matchAll(/!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s()]+(?:\([^()]*\)[^\s()]*)*))(?:\s+"[^"]*")?\s*\)/g)) targets.push(match[1] || match[2]);
        for (const match of plain.matchAll(/!?\[([^\]]+)\]\[([^\]]*)\]/g)) {
          const target = definitions.get((match[2] || match[1]).trim().toLowerCase());
          if (target) targets.push(target);
          else issue('link-reference-undefined', 'error', '链接引用没有定义', file, line, match[0], '补充对应的 [名称]: 地址 定义，或改用普通 Markdown 链接。');
        }
        for (const target of new Set(targets)) {
          if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) { externalLinks++; continue; }
          if (target.startsWith('#')) { anchorLinks++; continue; }
          let decoded;
          try { decoded = decodeURIComponent(target.split(/[?#]/)[0]); }
          catch { limitations.push(`${file}:${line}：链接编码无效，未检查 ${target}。`); continue; }
          if (decoded) checkFile(resolve(path.dirname(file), decoded), file, line, target, 'links');
        }
        continue;
      }
      if (!shell) continue;
      let command = text.trim().replace(/^\$\s+/, '');
      if (!command || command.startsWith('#')) continue;
      // Ambiguous shell constructs are never interpreted as reliable file references.
      if (/[;|<>`\\]/.test(command) || /\$\(/.test(command)) {
        limitations.push(`${file}:${line}：复杂 shell 语法未检查。`);
        if (/\bcd\b/.test(command)) cwdKnown = false;
        continue;
      }
      for (let part of command.split(/\s*&&\s*/)) {
        part = part.replace(/\s+#.*$/, '').trim();
        const tokens = part.match(/"[^"\n]*"|'[^'\n]*'|\S+/g)?.map(token => token.replace(/^(['"])(.*)\1$/, '$2')) || [];
        if (!tokens.length) continue;
        if (tokens[0] === 'cd') {
          if (tokens.length !== 2 || dynamic(tokens[1])) cwdKnown = false;
          else {
            const next = resolve(cwd, tokens[1]);
            if (next === '.' || entries.some(entry => entry.path === next && entry.type === 'tree')) { cwd = next; cwdKnown = true; }
            else if (cwd === '.' && (tokens[1] === repository.split('/')[1] || tokens[1].startsWith(`${repository.split('/')[1]}/`))) {
              const relative = tokens[1].split('/').slice(1).join('/') || '.';
              if (relative === '.' || entries.some(entry => entry.path === relative && entry.type === 'tree')) { cwd = relative; cwdKnown = true; }
              else { cwdKnown = false; limitations.push(`${file}:${line}：无法确定克隆目录内的 ${relative}，跳过后续命令。`); }
            }
            else { cwdKnown = false; limitations.push(`${file}:${line}：无法确定 cd ${tokens[1]} 后的工作目录，跳过后续命令。`); }
          }
          continue;
        }
        if (!cwdKnown) continue;
        const [tool, action] = tokens;
        const evidence = part;
        const target = value => resolve(cwd, value);
        if (['npm', 'pnpm', 'yarn'].includes(tool)) {
          // Global, workspace, prefix and exec invocations need their own resolution rules.
          if (tokens.some(token => token.startsWith('-'))) {
            limitations.push(`${file}:${line}：带选项的包管理命令未检查。`); continue;
          }
          let script = action === 'run' || action === 'run-script' ? tokens[2] : ['start', 'test'].includes(action) ? action : null;
          if (script && dynamic(script)) { limitations.push(`${file}:${line}：动态脚本名未检查。`); continue; }
          if (script) {
            const manifest = target('package.json');
            checkFile(manifest, file, line, evidence, 'commands', generated);
            if (paths.has(manifest)) {
              const data = parsedManifests.get(manifest);
              if (!data) limitations.push(`${file}:${line}：未读取到有效的 ${manifest}，未验证脚本 ${script}。`);
              else if (typeof data.scripts?.[script] !== 'string' && !(tool === 'npm' && script === 'start' && paths.has(target('server.js')))) {
                issue('npm-script-missing', 'error', `未定义 ${script} 脚本`, file, line, evidence, `在 ${manifest} 的 scripts 中添加 ${script}，或将文档改为已有脚本。`);
              }
            }
          } else if (tokens.length === 2 && ['install', 'ci'].includes(action)) {
            checkFile(target('package.json'), file, line, evidence, 'commands', generated);
            if (tool === 'npm' && action === 'ci' && !paths.has(target('package-lock.json')) && !paths.has(target('npm-shrinkwrap.json'))) {
              issue('npm-lock-missing', 'error', 'npm ci 缺少锁文件', file, line, evidence, '提交 package-lock.json 或 npm-shrinkwrap.json，或根据项目需要改用 npm install。');
            }
          }
        } else if ((tool === 'cp' || tool === 'copy') && tokens.length === 3 && !tokens[1].startsWith('-')) {
          checkFile(target(tokens[1]), file, line, evidence, /env|config/i.test(tokens[1]) ? 'configuration' : 'commands', generated);
          if (paths.has(target(tokens[1])) || generated.has(target(tokens[1]))) generated.add(target(tokens[2]));
        } else if (['node', 'python', 'python3', 'bash', 'sh'].includes(tool) && action && !action.startsWith('-')) {
          checkFile(target(action), file, line, evidence, 'commands', generated);
        } else if (['pip', 'pip3'].includes(tool) || (['python', 'python3'].includes(tool) && action === '-m' && tokens[2] === 'pip')) {
          const requirement = tokens.indexOf('-r');
          if (requirement >= 0 && tokens[requirement + 1]) checkFile(target(tokens[requirement + 1]), file, line, evidence, 'commands', generated);
        }
      }
    }
    const envLine = lines.findIndex(text => {
      const position = text.search(/(?:^|[\s`/])\.env(?=[\s`，。]|[.,](?:\s|$)|$)/);
      return position >= 0 && /\b(?:cp|copy|create|edit|configure|set|fill)\b|复制|创建|新建|编辑|填写|配置|设置|拷贝|打开/i.test(text.slice(0, position));
    });
    if (envLine >= 0) {
      checks.configuration++;
      if (!entries.some(entry => entry.type === 'blob' && sampleName.test(entry.path))) {
        issue('env-example-missing', 'warning', '文档要求配置 .env，但未找到环境变量示例', file, envLine + 1, '没有找到 .env.example、.env.sample、.env.template 或 example.env / sample.env。', '确认是否需要提供配置示例；如需提供，只填写变量名和示例值。');
      }
    }
  }
  const unique = findings.filter((finding, index, all) => all.findIndex(other => other.rule === finding.rule && other.file === finding.file && other.line === finding.line && other.evidence === finding.evidence) === index);
  return {
    repository, commit, branch: snapshot.branch, checkedAt: new Date().toISOString(),
    findings: unique,
    summary: { errors: unique.filter(item => item.severity === 'error').length, warnings: unique.filter(item => item.severity === 'warning').length, checks: Object.values(checks).reduce((sum, n) => sum + n, 0) },
    coverage: { ...checks, documents: Object.keys(documents), manifests: Object.keys(manifests), externalLinks, anchorLinks, skipped: [...new Set(limitations)] },
  };
}

export function reportMarkdown(report) {
  const lines = [`# ONE 仓库体检：${report.repository}`, '', `提交：${report.commit}`, `发现 ${report.summary.errors} 个问题，${report.summary.warnings} 个待确认项。执行 ${report.summary.checks} 次规则检查。`, ''];
  for (const item of report.findings) lines.push(`- ${item.severity === 'error' ? '问题' : '待确认'}：${item.title}`, `  位置：${item.file || '仓库根目录'}${item.line ? `:${item.line}` : ''}`, `  证据：${item.evidence}`, `  建议：${item.suggestion}`, `  ${item.url}`, '');
  if (!report.findings.length) lines.push('本次检查范围内未发现问题。', '');
  lines.push('## 检查范围', '', `读取 ${report.coverage.documents.length} 份 Markdown README、${report.coverage.manifests.length} 份 package.json。`, '只静态检查部分常见命令及 Markdown 本地文件链接，不执行代码，不验证外部网址或标题锚点。');
  if (report.coverage.skipped.length) lines.push('', '跳过项：', ...report.coverage.skipped.map(item => `- ${item}`));
  return lines.join('\n') + '\n';
}
