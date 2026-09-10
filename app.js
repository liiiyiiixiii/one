'use strict';
const model = window.OneTasks;
const input = document.querySelector('#task-input');
const list = document.querySelector('#task-list');
const notice = document.querySelector('#notice');
let tasks = [];
let filter = 'all';
let storageReadable = true;
try { tasks = model.decode(localStorage.getItem(model.key)); }
catch {
  storageReadable = false;
  notice.textContent = '无法读取已有数据。本次修改只在当前页面保留，以免覆盖原有内容。';
}
function update(next) {
  tasks = next;
  if (storageReadable) {
    try { localStorage.setItem(model.key, JSON.stringify(tasks)); notice.textContent = ''; }
    catch { notice.textContent = '浏览器暂时无法保存，刷新或关闭页面可能丢失本次修改。'; }
  }
  render();
}
function render() {
  list.replaceChildren();
  const visible = model.select(tasks, filter);
  const completed = tasks.filter(task => task.done).length;
  for (const task of visible) {
    const row = document.createElement('li');
    row.className = `task${task.done ? ' done' : ''}`;
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = task.done;
    checkbox.dataset.id = task.id;
    checkbox.addEventListener('change', () => {
      update(model.toggle(tasks, task.id));
      const remaining = [...list.querySelectorAll('input')].find(element => element.dataset.id === task.id);
      (remaining || input).focus();
    });
    const text = document.createElement('span');
    text.className = 'task-text';
    text.textContent = task.text;
    label.append(checkbox, text);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'delete';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `删除任务：${task.text}`);
    remove.addEventListener('click', () => { update(model.remove(tasks, task.id)); input.focus(); });
    row.append(label, remove);
    list.append(row);
  }
  document.querySelector('#empty').hidden = visible.length > 0;
  document.querySelector('#empty-title').textContent = filter === 'done' ? '还没有完成的任务' : filter === 'active' && tasks.length ? '都完成了，做得不错！' : '从一件小事开始';
  document.querySelector('#empty-copy').textContent = filter === 'done' ? '完成一件事，就勾选它。' : filter === 'active' && tasks.length ? '给自己留一点休息时间。' : '添加你的第一个任务，让今天更有条理。';
  document.querySelector('#count').textContent = `${tasks.length - completed} 项待完成`;
  document.querySelector('#progress').textContent = tasks.length ? `已完成 ${completed} / ${tasks.length} 项` : '慢慢来，一件一件完成。';
  document.querySelector('#clear').disabled = completed === 0;
  document.querySelectorAll('[data-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === filter)));
}
document.querySelector('#task-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!input.value.trim()) { input.value = ''; input.focus(); return; }
  filter = 'all';
  update(model.add(tasks, input.value, crypto.randomUUID()));
  input.value = '';
  input.focus();
});
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { filter = button.dataset.filter; render(); }));
document.querySelector('#clear').addEventListener('click', () => { update(model.clearDone(tasks)); input.focus(); });
window.addEventListener('storage', event => {
  if (event.key !== model.key && event.key !== null) return;
  try { tasks = model.decode(event.newValue); storageReadable = true; notice.textContent = ''; render(); }
  catch { storageReadable = false; notice.textContent = '其他页面的数据无法读取，本页已暂停保存，请先备份已有数据。'; }
});
render();
