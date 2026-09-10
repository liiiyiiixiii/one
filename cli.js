import { auditRepository } from './lib/github.js';
import { reportMarkdown } from './lib/audit.js';
const args = process.argv.slice(2);
if (!args[0] || args.includes('--help')) {
  console.log('用法：npm run audit -- owner/repo [--json] [--fail-on-error]');
} else {
  try {
    if (args.slice(1).some(arg => !['--json', '--fail-on-error'].includes(arg))) throw new Error('未知选项。可使用 --json 或 --fail-on-error。');
    const report = await auditRepository(args[0]);
    console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : reportMarkdown(report));
    if (args.includes('--fail-on-error') && report.summary.errors > 0) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
