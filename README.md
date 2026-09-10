# ONE · 今日清单

一个待办清单小项目，用 HTML、CSS 和 JavaScript 写的。可以添加任务、勾选完成、筛选和删除。

下载后打开 `index.html` 就能用，不需要安装依赖。

任务保存在当前浏览器里，不会同步到其他设备，清理浏览器数据也会一起删掉。

## 本地运行

如果直接打开文件无法保存，可以用 Python 3 启动：

```bash
python3 -m http.server 8000
```

然后打开 http://localhost:8000 。

## 测试

需要 Node.js 18 或以上版本。

```bash
npm run check
npm test
```
