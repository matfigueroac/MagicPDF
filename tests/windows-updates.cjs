const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const { mkdtemp, readdir, readFile, rm, rmdir } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createWindowsUpdates } = require('../electron/windows-updates.cjs');
const { findUpdate, downloadUpdate } = require('../electron/github-update.cjs');

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

test('an unpackaged build shows download guidance without loading the updater', async () => {
  const { updates, window, messages, calls } = fixture({ enabled: false });
  await updates.check(window);
  assert.match(messages[0].message, /GitHub Releases/);
  assert.deepEqual(calls, []);
  assert.equal(updates.installOnApprovedClose(), false);
});

const releaseBytes = Buffer.from('installer bytes');
const releaseAsset = {
  name: 'MagicPDF-Pro-Setup-1.12.10.exe',
  state: 'uploaded',
  size: releaseBytes.length,
  digest: 'sha256:' + createHash('sha256').update(releaseBytes).digest('hex'),
};
const latestRelease = { tag_name: 'v1.12.10', assets: [releaseAsset] };
const replyWith = release => async () => Response.json(release);

test('GitHub offers only newer stable releases with an uploaded installer and SHA-256', async () => {
  const update = await findUpdate('1.12.9', replyWith(latestRelease));
  assert.equal(update.version, '1.12.10');
  assert.match(update.url, /github\.com\/matfigueroac\/MagicPDF\/releases\/download\/v1\.12\.10\//);
  assert.equal(await findUpdate('1.12.10', replyWith(latestRelease)), null);
  assert.equal(await findUpdate('2.0.0', replyWith(latestRelease)), null);
  assert.equal(await findUpdate('1.12.9', async () => new Response(null, { status: 404 })), null);
  await assert.rejects(findUpdate('1.12.9', replyWith({ ...latestRelease, prerelease: true })), /no es válida/);
  await assert.rejects(findUpdate('1.12.9', replyWith({
    ...latestRelease, assets: [{ ...releaseAsset, digest: null }],
  })), /SHA-256/);
});

test('GitHub saves the verified installer with its Windows download mark and discards corrupted bytes', async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'magicpdf-update-test-'));
  const update = await findUpdate('1.12.9', replyWith(latestRelease));
  const destination = path.join(folder, update.filename);
  t.after(async () => {
    await rm(destination, { force: true });
    await rmdir(folder);
  });
  await assert.rejects(downloadUpdate(update, destination, async () => Response.redirect('https://example.com/a', 302)),
    /origen de descarga no admitido/);
  await downloadUpdate(update, destination, async (url, options) => {
    if (String(url) === update.url) {
      assert.equal(options.redirect, 'manual');
      return Response.redirect('https://release-assets.githubusercontent.com/installer', 302);
    }
    assert.equal(options.redirect, 'error');
    return new Response(releaseBytes);
  });
  assert.deepEqual(await readFile(destination), releaseBytes);
  if (process.platform === 'win32') {
    assert.match(await readFile(`${destination}:Zone.Identifier`, 'utf8'), /ZoneId=3/);
  }
  await assert.rejects(downloadUpdate(update, destination, async () => new Response('Invalid bytes')), /SHA-256/);
  assert.deepEqual(await readFile(destination), releaseBytes);
  assert.deepEqual(await readdir(folder), [update.filename]);
});

test('the unsigned edition saves only with consent and reveals the verified installer without running it', async () => {
  const window = { isDestroyed: () => false };
  const update = await findUpdate('1.12.9', replyWith(latestRelease));
  const destination = path.join('downloads', update.filename);
  const calls = [];
  let cancel = true;
  const updates = createWindowsUpdates({
    enabled: true, version: '1.12.9',
    checkGitHub: async () => update,
    downloadsDirectory: () => 'downloads',
    dialog: {
      showMessageBox: async () => ({ response: 0 }),
      showSaveDialog: async (_window, options) => {
        assert.equal(options.defaultPath, destination);
        return { canceled: cancel, filePath: destination };
      },
    },
    downloadGitHub: async (release, file) => calls.push(['download', release, file]),
    showInstaller: file => calls.push(['show', file]),
    loadUpdater() { assert.fail('The signed updater was loaded.'); },
  });

  await updates.check(window);
  assert.deepEqual(calls, []);
  cancel = false;
  await updates.check(window);
  assert.deepEqual(calls, [['download', update, destination], ['show', destination]]);
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
