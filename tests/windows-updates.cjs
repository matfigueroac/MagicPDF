const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const { createWindowsUpdates } = require('../electron/windows-updates.cjs');

function fixture({ enabled = true, response = 0, available = true, checkError, signatureError, storeBuild = false } = {}) {
  const publisher = 'CN=MagicPDF Test';
  const installer = 'MagicPDF-Pro-Setup-1.12.5.exe';
  const messages = [];
  const calls = [];
  const updater = Object.assign(new EventEmitter(), {
    async checkForUpdates() {
      calls.push('check');
      if (checkError) throw checkError;
      return { isUpdateAvailable: available, updateInfo: { version: '1.12.5' } };
    },
    async downloadUpdate() {
      calls.push('download');
      return [installer];
    },
    quitAndInstall() { calls.push('install'); },
  });
  const window = { isDestroyed: () => false };
  const updates = createWindowsUpdates({
    enabled, publisher, storeBuild, version: '1.12.4',
    dialog: {
      async showMessageBox(parent, options) {
        assert.equal(parent, window);
        messages.push(options);
        return { response };
      },
    },
    loadUpdater() { calls.push('load'); return updater; },
    async validateInstaller(file, expectedPublisher) {
      assert.equal(file, installer);
      assert.equal(expectedPublisher, publisher);
      calls.push('verify');
      if (signatureError) throw signatureError;
    },
  });
  return { updater, updates, window, messages, calls };
}

test('an unsigned build shows download guidance without loading the updater', async () => {
  const { updates, window, messages, calls } = fixture({ enabled: false });
  await updates.check(window);
  assert.match(messages[0].message, /instalaciones firmadas/);
  assert.deepEqual(calls, []);
  assert.equal(updates.installOnApprovedClose(), false);
});

test('the Microsoft Store edition uses Store updates even if an installer publisher is configured', async () => {
  const { updates, window, messages, calls } = fixture({ storeBuild: true });
  await updates.check(window);
  assert.match(messages[0].message, /Microsoft Store/);
  assert.deepEqual(calls, []);
  assert.equal(updates.installOnApprovedClose(), false);
});

test('the user can decline an available update', async () => {
  const { updates, window, messages, calls, updater } = fixture({ response: 1 });
  await updates.check(window);
  assert.deepEqual(calls, ['load', 'check']);
  assert.match(messages[0].message, /1\.12\.5 está disponible/);
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updates.installOnApprovedClose(), false);
});

test('a verified update installs once after the document close is approved', async () => {
  const { updates, window, messages, calls } = fixture();
  await updates.check(window);
  await updates.check(window);
  assert.deepEqual(calls, ['load', 'check', 'download', 'verify']);
  assert.match(messages.at(-1).message, /cuando cierres MagicPDF/);
  assert.equal(updates.installOnApprovedClose(), true);
  assert.equal(updates.installOnApprovedClose(), false);
  assert.deepEqual(calls, ['load', 'check', 'download', 'verify', 'install']);
});

test('an installer with an invalid signature never reaches installation', async () => {
  const { updates, window, messages, calls } = fixture({ signatureError: Error('invalid signature') });
  await updates.check(window);
  assert.deepEqual(calls, ['load', 'check', 'download', 'verify']);
  assert.equal(messages.at(-1).type, 'warning');
  assert.equal(updates.installOnApprovedClose(), false);
});

test('the update menu reports the current version and network errors', async () => {
  const current = fixture({ available: false });
  await current.updates.check(current.window);
  assert.match(current.messages[0].message, /1\.12\.4 está al día/);
  const offline = fixture({ checkError: Error('offline') });
  await offline.updates.check(offline.window);
  assert.equal(offline.messages[0].type, 'warning');
  assert.deepEqual(offline.calls, ['load', 'check']);
  assert.equal(offline.updates.installOnApprovedClose(), false);
});
