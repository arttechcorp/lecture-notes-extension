const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('capture entry resets persisted auto-open, keeps gesture, and carries popup tab ID', async () => {
  const handlers = {}, opened = [], windows = [];
  const event = name => ({ addListener: fn => { handlers[name] = fn; } });
  let autoOpen = true, sidePanelFails = false;
  const chrome = {
    runtime: { id: 'test', getURL: p => `chrome-extension://test/${p}`, onInstalled: event('installed'), onStartup: event('startup'), onMessage: event('message') },
    sidePanel: { setPanelBehavior: async options => { autoOpen = options.openPanelOnActionClick; }, open: options => { opened.push(options.tabId); return sidePanelFails ? Promise.reject(new Error('Unsupported window')) : Promise.resolve(); } },
    action: { onClicked: event('action') }, commands: { onCommand: event('command') },
    tabs: { onRemoved: event('removed'), onUpdated: event('updated') },
    storage: { local: { setAccessLevel: async () => {} } },
    windows: { create: async options => { windows.push(options); } },
  };
  vm.runInNewContext(fs.readFileSync('background.js', 'utf8'), { chrome, URL, console });
  handlers.installed();
  assert.equal(autoOpen, false, 'Reload must reset a previously saved true value');
  handlers.action({ id: 41, windowId: 5, url: 'https://lecture.example/watch' });
  assert.deepEqual(opened, [41], 'Panel must open synchronously in the action gesture');
  handlers.command('open-capture-panel', { id: 73, windowId: 8, url: 'https://lecture.example/popup' });
  assert.equal(windows[0].url, 'chrome-extension://test/sidepanel.html?tabId=73');
  assert.equal(windows[0].type, 'popup');
  handlers.command('unrelated', { id: 41, url: 'https://lecture.example/watch' });
  handlers.command('open-capture-panel', { id: 41, url: 'chrome://extensions' });
  assert.equal(windows.length, 1);
  sidePanelFails = true;
  handlers.action({ id: 73, windowId: 8, url: 'https://lecture.example/popup' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(windows[1].url, 'chrome-extension://test/sidepanel.html?tabId=73');
});
