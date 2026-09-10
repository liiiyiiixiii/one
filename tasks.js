/* Shared by the browser and Node's built-in test runner. */
(function (root) {
  const key = 'one.tasks.v1';
  function decode(raw) {
    if (raw === null) return [];
    const tasks = JSON.parse(raw);
    if (!Array.isArray(tasks)) throw new Error('Invalid task data');
    const ids = new Set();
    for (const task of tasks) {
      if (!task || typeof task.id !== 'string' || ids.has(task.id) ||
          typeof task.text !== 'string' || !task.text.trim() || task.text.length > 200 ||
          typeof task.done !== 'boolean') throw new Error('Invalid task data');
      ids.add(task.id);
    }
    return tasks;
  }
  function add(tasks, text, id) {
    text = text.trim();
    if (!text || text.length > 200) return tasks;
    return [...tasks, { id, text, done: false }];
  }
  function toggle(tasks, id) {
    return tasks.map(task => task.id === id ? { ...task, done: !task.done } : task);
  }
  function remove(tasks, id) { return tasks.filter(task => task.id !== id); }
  function clearDone(tasks) { return tasks.filter(task => !task.done); }
  function select(tasks, filter) {
    return tasks.filter(task => filter === 'all' || (filter === 'done' ? task.done : !task.done));
  }
  const api = { key, decode, add, toggle, remove, clearDone, select };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OneTasks = api;
})(globalThis);
