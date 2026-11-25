import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const io = fs.promises;
const receiptPattern = /^(\d+)-([0-9a-f-]{36})\.(opening|ready)\.json$/;
type Receipt = { filename: string; name: string; original?: string };
type Entry = Receipt & { marker: string; initialHash?: string };

function ownerAlive(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (error: any) { return error.code !== 'ESRCH'; }
}

async function digest(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export class WorkCopies {
  private readonly receipts: string;
  private active = new Map<string, Entry>();
  private retained = new Map<string, Entry>();
  constructor(private directory: string, private recoveryLimit = 10 * 1024 ** 3) {
    this.receipts = path.join(path.dirname(directory), 'work-copy-records');
  }

  async start() {
    await io.mkdir(this.receipts, {recursive:true});
    for (const item of await io.readdir(this.receipts, {withFileTypes:true})) {
      const match = receiptPattern.exec(item.name);
      if (!item.isFile() || !match) continue;
      const previousPid = Number(match[1]);
      // At startup this instance has no receipts yet. Its PID may have been recycled.
      if (previousPid !== process.pid && ownerAlive(previousPid)) continue;
      const old = path.join(this.receipts, item.name);
      const marker = path.join(this.receipts, item.name.replace(/^\d+-/, process.pid + '-'));
      try {
        // A second live instance cannot adopt the same receipt.
        if (old !== marker) await io.rename(old, marker);
        const data: Receipt = JSON.parse(await io.readFile(marker, 'utf8'));
        if (typeof data.filename !== 'string' || !data.filename.startsWith(match[2] + '_') ||
            path.basename(data.filename) !== data.filename || /[\\/]/.test(data.filename))
          throw new Error('Registro de copia inválido');
        const entry = {...data, marker};
        const file = path.join(this.directory, entry.filename);
        const stat = await io.lstat(file).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        });
        if (!stat) { await io.unlink(marker); continue; }
        if (!stat.isFile()) continue;
        if (match[3] === 'opening' || await this.matchesOriginal(entry, stat.size)) {
          await this.remove(entry);
        } else {
          this.retained.set(entry.filename, entry);
        }
      } catch (error: any) {
        if (error.code !== 'ENOENT') console.warn('No se pudo revisar un registro de copia', error.message);
      }
    }
  }

  private async matchesOriginal(entry: Entry, size: number) {
    if (!entry.original) return false;
    try {
      const stat = await io.stat(entry.original);
      if (!stat.isFile() || stat.size !== size) return false;
      const [source, copy] = await Promise.all([digest(entry.original), digest(path.join(this.directory, entry.filename))]);
      return source === copy;
    } catch { return false; }
  }

  async begin(name: string, original?: string) {
    if (this.retained.size && (await this.recoveries()).reduce((sum, file) => sum + file.size, 0) >= this.recoveryLimit)
      throw new Error('El espacio de recuperación está lleno. Descarga y descarta copias desde el área de trabajo para abrir más PDF.');
    const id = randomUUID();
    const filename = id + '_' + path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_');
    const marker = path.join(this.receipts, process.pid + '-' + id + '.opening.json');
    const record = {filename, name:path.basename(name), original};
    await io.writeFile(marker, JSON.stringify(record), {flag:'wx', flush:true});
    this.active.set(filename, {...record, marker});
    return filename;
  }

  async ready(filename: string) {
    const entry = this.active.get(filename)!;
    if (!entry.original) entry.initialHash = await digest(path.join(this.directory, filename));
    const marker = entry.marker.replace('.opening.json', '.ready.json');
    await io.rename(entry.marker, marker);
    entry.marker = marker;
  }

  private async remove(entry: Entry) {
    await io.rm(path.join(this.directory, entry.filename), {force:true});
    await io.rm(entry.marker, {force:true});
  }

  async abort(filename: string, keepFile = false) {
    const entry = this.active.get(filename);
    if (!entry) return;
    if (keepFile) await io.rm(entry.marker, {force:true});
    else await this.remove(entry);
    this.active.delete(filename);
  }

  async release(filename: string, approvedVersion?: string) {
    const entry = this.active.get(filename);
    if (!entry) return;
    const file = path.join(this.directory, filename);
    const clean = approvedVersion ? approvedVersion === await digest(file)
      : entry.original ? await this.matchesOriginal(entry, (await io.stat(file)).size)
      : entry.initialHash === await digest(file);
    if (clean) await this.remove(entry);
    else this.retained.set(filename, entry);
    this.active.delete(filename);
  }

  detach(filename: string) {
    const entry = this.active.get(filename);
    if (entry) {
      this.retained.set(filename, entry);
      this.active.delete(filename);
    }
  }

  async recoveries() {
    const files = [];
    for (const entry of this.retained.values()) {
      try {
        const stat = await io.lstat(path.join(this.directory, entry.filename));
        if (stat.isFile()) files.push({filename:entry.filename, name:entry.name, size:stat.size});
      } catch (error: any) {
        if (error.code !== 'ENOENT') throw error;
        await io.rm(entry.marker, {force:true});
        this.retained.delete(entry.filename);
      }
    }
    return files;
  }

  recovery(filename: string) { return this.retained.get(filename); }

  async discard(filename: string) {
    const entry = this.retained.get(filename);
    if (!entry) throw new Error('Copia no disponible.');
    await this.remove(entry);
    this.retained.delete(filename);
  }
}
