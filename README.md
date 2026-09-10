# ONE · 仓库体检

输入 GitHub 公开仓库地址，检查 README 里引用的文件是否存在、启动命令是否对应实际脚本、配置示例有没有遗漏。结果带文件行号，可以直接跳到 GitHub 修改。

## 运行

需要 Node.js 22 或更新版本，无第三方依赖。

```bash
git clone https://github.com/liiiyiiixiii/one.git
cd one
npm start
```

打开 http://127.0.0.1:3000 。也可以在命令行检查：

```bash
npm run audit -- liiiyiiixiii/one
```

加 `--json` 输出 JSON，加 `--fail-on-error` 在发现确定问题时返回退出码 1。请求失败返回 2。

## 能查什么

- Markdown 普通链接、图片和引用式链接指向的本地文件。
- `npm / pnpm / yarn run`、`start`、`test` 是否对应 package.json 脚本；`npm ci` 是否有锁文件。
- `node`、`python`、`bash`、`pip -r` 和 `cp` 等常见命令引用的文件。
- 文档要求使用环境文件时，仓库是否提供常见命名的配置示例。此项只提示人工确认。

只读取默认分支，并固定到同一次提交。每次最多读 20 份 Markdown README 和 package.json，单文件上限 180 KB，跳过项会列在报告里。同一输入的结果缓存两分钟。

不执行代码、不检查外部网址和标题锚点，也不是完整的 Markdown 或 shell 解析器。命令从 README 所在目录开始分析，每个代码块重新计算目录；复杂语法会跳过。检查通过不代表项目一定能运行。

GitHub 有请求额度限制。遇到限流可稍后重试，或在服务端环境变量中设置 `GITHUB_TOKEN`，重启后生效。令牌不需要填到网页里，勿提交到仓库。

## 开发

```bash
npm run check
npm test
```

`lib/audit.js` 是检查规则，`lib/github.js` 负责读取 GitHub，`server.js` 提供本地接口。网页和命令行使用同一套规则。
