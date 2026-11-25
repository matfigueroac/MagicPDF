const assert = require('node:assert/strict');
const fs = require('node:fs');
const io = fs.promises;
const path = require('node:path');
const { fork, spawn: spawnProcess } = require('node:child_process');
const { once } = require('node:events');
const { PDFDocument } = require('pdf-lib');
const { savePdf, cleanSaveStages } = require('../electron/atomic-save.cjs');

async function child(mode, directory) {
  if (mode === 'server') {
    const port = await require(path.join(directory, 'dist-server/index.cjs')).startServer(0);
    process.send(port);
    return;
  }
  const working = path.join(directory, 'uploads/work.pdf');
  const original = path.join(directory, 'original.pdf');
  if (mode === 'interrupt' || mode === 'partial') {
    const suspend = async () => {
      process.send(mode);
      await new Promise(() => setInterval(() => {}, 60000));
    };
    if (mode === 'interrupt') io.rename = suspend;
    else {
      const open = io.open.bind(io);
      io.open = async (...args) => {
        const handle = await open(...args);
        if (args[1] === 'wx') {
          const write = handle.writeFile.bind(handle);
          handle.writeFile = async bytes => {
            await write(bytes.subarray(0, Math.max(1, bytes.length >> 1)));
            await suspend();
          };
        }
        return handle;
      };
    }
    await savePdf(working, original, path.dirname(working));
  } else {
    if (mode === 'full') {
      const open = io.open.bind(io);
      io.open = async (...args) => {
        const handle = await open(...args);
        if (args[1] === 'wx') handle.sync = async () => { throw Object.assign(new Error('ENOSPC'), {code:'ENOSPC'}); };
        return handle;
      };
    } else {
      io.rename = async () => { throw Object.assign(new Error('EBUSY'), {code:'EBUSY'}); };
    }
    await assert.rejects(savePdf(working, original, path.dirname(working)), {code:mode === 'full' ? 'ENOSPC' : 'EBUSY'});
  }
}

async function run() {
  const root = path.resolve(__dirname, '..');
  await io.mkdir(path.join(root, 'work'), {recursive:true});
  const directory = await io.mkdtemp(path.join(root, 'work/durability-'));
  const children = new Set();
  let browser;
  const spawn = mode => {
    const proc = fork(__filename, [mode, directory], {cwd:directory, silent:true});
    children.add(proc);
    proc.stdout.resume();
    proc.stderr.pipe(process.stderr);
    proc.once('exit', () => children.delete(proc));
    return proc;
  };
  async function stop(proc) {
    const exited = once(proc, 'exit');
    proc.kill('SIGKILL');
    await exited;
  }
  async function firstMessage(proc) {
    const signal = AbortSignal.timeout(30000);
    return Promise.race([
      once(proc, 'message', {signal}).then(([value]) => value),
      once(proc, 'exit', {signal}).then(([code]) => { throw new Error('Proceso de prueba terminado antes de tiempo: ' + code); }),
    ]);
  }
  async function start() {
    const proc = spawn('server');
    const port = await firstMessage(proc);
    return {proc, url:'http://127.0.0.1:' + port};
  }
  async function post(url, route, body) {
    const response = await fetch(url + '/api/' + route, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    assert.ok(response.ok, await response.clone().text());
    return response.status === 204 ? null : response.json();
  }
  try {
    const original = path.join(directory, 'original.pdf');
    const uploads = path.join(directory, 'uploads');
    const working = path.join(uploads, 'work.pdf');
    await io.mkdir(uploads);
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const first = Buffer.from(await pdf.save());
    pdf.addPage();
    const edited = Buffer.from(await pdf.save());
    await io.writeFile(original, first);
    await io.writeFile(working, edited);
    for (const mode of ['full', 'locked']) {
      assert.equal((await once(spawn(mode), 'exit'))[0], 0);
      assert.deepEqual(await io.readFile(original), first);
      assert.equal((await io.readdir(directory)).filter(name => name.endsWith('.tmp')).length, 0);
    }
    for (const mode of ['partial','interrupt']) {
      const writer = spawn(mode);
      assert.equal(await firstMessage(writer), mode);
      await cleanSaveStages(uploads);
      assert.equal((await io.readdir(directory)).filter(name => name.endsWith('.tmp')).length, 1);
      await stop(writer);
      await cleanSaveStages(uploads);
      assert.equal((await io.readdir(directory)).filter(name => name.endsWith('.tmp')).length, 0);
      assert.deepEqual(await io.readFile(original), first);
    }
    assert.deepEqual(await io.readFile(working), edited);
    if (process.platform === 'win32') {
      const locker = spawnProcess('powershell.exe', ['-NoProfile','-Command',
        '$f=[IO.File]::Open($env:MAGICPDF_LOCK_FIXTURE,"Open","Read","None"); [Console]::WriteLine("locked"); [void][Console]::ReadLine(); $f.Dispose()'],
        {windowsHide:true, env:{...process.env, MAGICPDF_LOCK_FIXTURE:original}});
      try {
        assert.match(String((await once(locker.stdout, 'data'))[0]), /locked/);
        await assert.rejects(savePdf(working, original, uploads));
      } finally {
        const done = once(locker, 'exit'); locker.stdin.end('\n'); await done;
      }
      assert.deepEqual(await io.readFile(original), first);
    }
    await savePdf(working, original, uploads);
    assert.deepEqual(await io.readFile(original), edited);
    console.log('PASS original intact after killing a partial write and before rename, ENOSPC and locked destination; successful retry');

    await io.mkdir(path.join(directory, 'dist-server'));
    await io.copyFile(path.join(root, 'dist-server/index.cjs'), path.join(directory, 'dist-server/index.cjs'));
    await io.cp(path.join(root, 'dist'), path.join(directory, 'dist'), {recursive:true});
    const server = await start();
    const open = async (url, targetPath) => (await post(url, 'open-file-path', {targetPath})).document;
    const clean = await open(server.url, original);
    const dirty = await open(server.url, original);
    const sameSizeEdit = Buffer.from(edited);
    sameSizeEdit[sameSizeEdit.indexOf(0x0a)] = 0x0d;
    await io.writeFile(dirty.path, sameSizeEdit);
    const detached = path.join(directory, 'moved.pdf');
    await io.writeFile(detached, edited);
    const missing = await open(server.url, detached);
    await io.rename(detached, path.join(directory, 'elsewhere.pdf'));
    const legacy = path.join(path.dirname(clean.path), '00000000-0000-0000-0000-000000000001_original.pdf');
    await io.writeFile(legacy, first);
    const form = new FormData();
    form.append('files', new Blob([edited]), 'upload.pdf');
    const uploaded = (await (await fetch(server.url + '/api/upload', {method:'POST', body:form})).json()).documents[0];
    const parallel = await start();
    assert.deepEqual(await (await fetch(parallel.url + '/api/workspace/recoveries')).json(), []);
    assert.deepEqual(await io.readFile(clean.path), edited);
    await stop(parallel.proc);
    await stop(server.proc);
    const restarted = await start();
    const list = async () => (await fetch(restarted.url + '/api/workspace/recoveries')).json();
    const recoveries = await list();
    assert.deepEqual(recoveries.map(x => x.filename).sort(), [dirty.filename, missing.filename, uploaded.filename].sort());
    assert.deepEqual(await io.readFile(legacy), first);
    await assert.rejects(io.stat(clean.path), {code:'ENOENT'});
    for (const [doc, bytes] of [[dirty, sameSizeEdit], [missing, edited], [uploaded, edited]]) {
      const response = await fetch(restarted.url + '/api/workspace/recoveries/' + doc.filename);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    }
    console.log('PASS restart removes identical native copy; preserves edits, moved source, browser upload, historical file and live sessions');

    const { chromium } = require('@playwright/test');
    browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const page = await browser.newPage();
    await page.goto(restarted.url);
    const row = page.getByRole('listitem').filter({hasText:'upload.pdf'});
    await row.waitFor();
    const download = page.waitForEvent('download');
    await row.getByRole('link', {name:'Descargar'}).click();
    assert.deepEqual(await io.readFile(await (await download).path()), edited);
    page.once('dialog', d => d.dismiss());
    await row.getByRole('button', {name:'Descartar'}).click();
    assert.equal((await list()).length, 3);
    page.once('dialog', d => d.accept());
    await row.getByRole('button', {name:'Descartar'}).click();
    await row.waitFor({state:'detached'});
    assert.equal((await list()).length, 2);
    await page.locator('input[type=file]').first().setInputFiles({name:'Sesion-web.pdf', mimeType:'application/pdf', buffer:first});
    await page.getByRole('tab', {name:'Sesion-web.pdf', exact:true}).waitFor();
    await page.reload();
    const resumed = page.getByRole('listitem').filter({hasText:'Sesion-web.pdf'});
    await resumed.waitFor();
    page.once('dialog', d => d.accept());
    await resumed.getByRole('button', {name:'Descartar'}).click();
    await resumed.waitFor({state:'detached'});
    await browser.close(); browser = undefined;
    for (let i = 0; i < 4; i++) {
      const doc = await open(restarted.url, original);
      await io.writeFile(doc.path, i % 2 ? edited : first);
      await post(restarted.url, 'save-to-path', {filename:doc.filename, targetPath:original});
      await post(restarted.url, 'workspace/release', {filename:doc.filename});
      await assert.rejects(io.stat(doc.path), {code:'ENOENT'});
    }
    await stop(restarted.proc);
    const final = await start();
    assert.equal((await (await fetch(final.url + '/api/workspace/recoveries')).json()).length, 2);
    assert.deepEqual(await io.readFile(legacy), first);
    await stop(final.proc);
    console.log('PASS recovery download, cancel, discard and browser reload; four open/edit/save/close cycles leave zero extra copies');
    require('tsx/cjs');
    const { WorkCopies } = require('../server/work-copies.ts');
    const small = new WorkCopies(uploads, 100);
    await small.start();
    const name = await small.begin('quota.pdf');
    await io.writeFile(path.join(uploads, name), first);
    await small.ready(name);
    await io.writeFile(path.join(uploads, name), edited);
    // A stale close decision cannot discard a later edit.
    await small.release(name, require('node:crypto').createHash('sha256').update(first).digest('hex'));
    await assert.rejects(small.begin('second.pdf'), /espacio de recuperación/);
    assert.deepEqual(await io.readFile(path.join(uploads, name)), edited);
    await small.discard(name);
    const next = await small.begin('second.pdf');
    await small.abort(next);
    console.log('PASS recovery budget blocks new copies, preserves data and resumes after confirmed discard');
  } finally {
    if (browser) await browser.close();
    await Promise.all([...children].map(stop));
    assert.equal(path.dirname(directory), path.join(root, 'work'));
    await io.rm(directory, {recursive:true, force:true});
  }
}

(process.argv[2] ? child(process.argv[2], process.argv[3]) : run()).catch(error => {
  console.error(error); process.exitCode = 1;
});
