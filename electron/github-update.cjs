const { createHash } = require('node:crypto');
const { createWriteStream } = require('node:fs');
const { mkdtemp, rename, rmdir, unlink, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const RELEASES = 'https://github.com/matfigueroac/MagicPDF/releases';
const LATEST = 'https://api.github.com/repos/matfigueroac/MagicPDF/releases/latest';
const VERSION = /^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/;
const MAX_INSTALLER_SIZE = 512 * 1024 * 1024;
const ASSET_HOSTS = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com']);

function versionParts(version) {
  return typeof version === 'string' && VERSION.exec(version)?.slice(1).map(Number);
}

async function findUpdate(version, request = fetch) {
  const response = await request(LATEST, {
    headers: { Accept: 'application/vnd.github+json' },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub respondió con HTTP ${response.status}.`);
  const release = await response.json();
  const tag = release.tag_name;
  const nextVersion = typeof tag === 'string' && tag.startsWith('v') && tag.slice(1);
  const next = versionParts(nextVersion);
  const current = versionParts(version);
  if (release.draft || release.prerelease || !next || !current) {
    throw new Error('La versión publicada en GitHub no es válida.');
  }
  const changed = next.findIndex((part, index) => part !== current[index]);
  if (changed === -1 || next[changed] < current[changed]) return null;

  const filename = `MagicPDF-Pro-Setup-${nextVersion}.exe`;
  const matches = release.assets?.filter(asset => asset.name === filename) ?? [];
  const [asset] = matches;
  const digest = /^sha256:([0-9a-f]{64})$/i.exec(asset?.digest ?? '')?.[1]?.toLowerCase();
  if (matches.length !== 1 || asset.state !== 'uploaded' || !digest ||
      !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > MAX_INSTALLER_SIZE) {
    throw new Error('La versión no incluye un instalador con SHA-256 verificable.');
  }
  return { version: nextVersion, filename, size: asset.size, digest, url: `${RELEASES}/download/${tag}/${filename}` };
}

async function downloadUpdate(update, destination, request = fetch) {
  const signal = AbortSignal.timeout(180_000);
  const directory = await mkdtemp(path.join(path.dirname(destination), '.magicpdf-update-'));
  const partial = path.join(directory, 'installer.tmp');
  let size = 0;
  const hash = createHash('sha256');
  try {
    let response = await request(update.url, { redirect: 'manual', signal });
    if (response.status === 302) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      const redirect = new URL(location);
      if (redirect.protocol !== 'https:' || redirect.port || redirect.username ||
          redirect.password || !ASSET_HOSTS.has(redirect.hostname)) {
        throw new Error('GitHub devolvió un origen de descarga no admitido.');
      }
      response = await request(redirect, { redirect: 'error', signal });
    }
    if (response.status !== 200 || !response.body) {
      await response.body?.cancel();
      throw new Error(`No se pudo descargar el instalador (HTTP ${response.status}).`);
    }
    await pipeline(Readable.fromWeb(response.body), new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length;
        if (size > update.size) return callback(new Error('La descarga supera el tamaño publicado.'));
        hash.update(chunk);
        callback(null, chunk);
      },
    }), createWriteStream(partial, { flags: 'wx' }), { signal });
    if (size !== update.size || hash.digest('hex') !== update.digest) {
      throw new Error('El instalador no coincide con el SHA-256 publicado.');
    }
    if (process.platform === 'win32') {
      await writeFile(`${partial}:Zone.Identifier`, `[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=${update.url}\r\n`);
    }
    await rename(partial, destination);
  } finally {
    await unlink(partial).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await rmdir(directory);
  }
}

module.exports = { RELEASES, findUpdate, downloadUpdate };
