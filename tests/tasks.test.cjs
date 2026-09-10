const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../tasks.js');
test('添加、筛选、完成、取消完成、删除和批量清理', () => {
  let tasks = model.add([], '  学习 GitHub  ', 'a');
  tasks = model.add(tasks, '散步', 'b');
  assert.equal(tasks[0].text, '学习 GitHub');
  const before = tasks;
  tasks = model.toggle(tasks, 'a');
  assert.equal(before[0].done, false);
  assert.deepEqual(model.select(tasks, 'done').map(t => t.id), ['a']);
  assert.deepEqual(model.select(tasks, 'active').map(t => t.id), ['b']);
  assert.equal(model.toggle(tasks, 'a')[0].done, false);
  assert.deepEqual(model.clearDone(tasks).map(t => t.id), ['b']);
  assert.deepEqual(model.remove(tasks, 'b').map(t => t.id), ['a']);
});
test('空白和超长输入不会创建任务', () => {
  assert.deepEqual(model.add([], '   ', 'a'), []);
  assert.deepEqual(model.add([], 'a'.repeat(201), 'a'), []);
});
test('本地存储往返保持中文内容和完成状态', () => {
  const tasks = model.toggle(model.add([], '读书 📖', 'a'), 'a');
  assert.deepEqual(model.decode(JSON.stringify(tasks)), tasks);
  assert.deepEqual(model.decode(null), []);
});
test('损坏或结构不正确的数据不会被静默接受', () => {
  for (const raw of ['invalid', '{}', '[null]', '[{"id":"a","text":"x","done":"false"}]']) {
    assert.throws(() => model.decode(raw));
  }
  const task = { id: 'a', text: 'x', done: false };
  assert.throws(() => model.decode(JSON.stringify([task, task])));
});
