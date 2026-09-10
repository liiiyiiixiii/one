# ONE · 仓库体检

代码改了，README 里的路径和命令却不一定跟着改。ONE 用来找这类遗漏：文件链接指向了哪里、启动脚本还在不在、配置示例有没有提交。

输入一个 GitHub 公开仓库地址，就能看到检查结果和对应的文件行号。

## 怎么用

需要 Node.js 22 或以上版本，不用装依赖。

```bash
git clone https://github.com/liiiyiiixiii/one.git
cd one
npm start
```

打开 http://127.0.0.1:3000 ，填入仓库地址即可。

也可以直接在终端里用：

```bash
npm run audit -- liiiyiiixiii/one
```

加 `--json` 可以输出 JSON 报告。

目前只查默认分支的 Markdown README 和常见启动命令，不会执行代码，也不查外部网址。最多读取 20 个文件，没查到的部分会注明。没有报错，也不代表项目一定能跑起来。

遇到 GitHub 限流，可以等一会儿再试，或者在环境变量里设置 `GITHUB_TOKEN` 后重启。

## 改代码

检查规则在 `lib/audit.js`，读取 GitHub 的代码在 `lib/github.js`。

```bash
npm run check
npm test
```
