const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const AUTHENTICODE_TIMEOUT_MS = 120_000;

async function readInstallerSignature(file) {
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0');
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => name.toLowerCase() !== 'psmodulepath'));
  env.PSModulePath = path.join(powershell, 'Modules');
  env.MAGICPDF_UPDATE_FILE = file;
  const { stdout } = await promisify(execFile)(path.join(powershell, 'powershell.exe'), [
    '-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference = 'Stop'; $sign = Get-AuthenticodeSignature -LiteralPath $env:MAGICPDF_UPDATE_FILE; " +
    '[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); ' +
    '@{ status = $sign.Status.ToString(); type = $sign.SignatureType.ToString(); ' +
    'publisher = $sign.SignerCertificate.Subject; thumbprint = $sign.SignerCertificate.Thumbprint; ' +
    'timestamped = ($null -ne $sign.TimeStamperCertificate) } | ConvertTo-Json -Compress',
  ], { env, windowsHide: true, timeout: AUTHENTICODE_TIMEOUT_MS });
  return JSON.parse(stdout);
}

async function verifyInstaller(file, publisher, { thumbprint, requireTimestamp = false } = {}) {
  const signature = await readInstallerSignature(file);
  if (signature.status !== 'Valid' || signature.type !== 'Authenticode') {
    throw new Error(`Firma Authenticode inválida (${signature.status}).`);
  }
  if (signature.publisher !== publisher) throw new Error('El instalador pertenece a otro editor.');
  if (thumbprint && signature.thumbprint !== thumbprint) throw new Error('El instalador tiene otra huella de firma.');
  if (requireTimestamp && !signature.timestamped) throw new Error('La firma del instalador no tiene sello de tiempo.');
}

function createWindowsUpdates({
  dialog, publisher, enabled, version, storeBuild = false,
  loadUpdater = () => require('electron-updater').autoUpdater,
  validateInstaller = verifyInstaller,
}) {
  let updater;
  let busy = false;
  let ready = false;

  async function check(window) {
    if (busy || window.isDestroyed()) return;
    const notice = (message, type = 'info') => dialog.showMessageBox(window, {
      type, title: 'Actualizaciones de MagicPDF', message,
    });
    if (storeBuild) {
      await notice('Microsoft Store administra las actualizaciones de esta edición. Para buscarlas, abre Microsoft Store y ve a Descargas.');
      return;
    }
    if (!enabled || !publisher) {
      await notice('Las actualizaciones desde la aplicación están disponibles en las instalaciones firmadas. Consulta las descargas en GitHub Releases.');
      return;
    }
    busy = true;
    try {
      if (ready) {
        await notice('La actualización se instalará cuando cierres MagicPDF.');
        return;
      }
      if (!updater) {
        updater = loadUpdater();
        updater.autoDownload = false;
        updater.autoInstallOnAppQuit = false;
        updater.allowPrerelease = false;
        updater.on('error', error => console.warn('MagicPDF updater:', error.message));
      }
      const result = await updater.checkForUpdates();
      if (window.isDestroyed()) return;
      if (!result) throw new Error('El canal de actualizaciones no está disponible.');
      if (!result.isUpdateAvailable) {
        await notice(`Tu versión ${version} está al día.`);
        return;
      }
      const { response } = await dialog.showMessageBox(window, {
        type: 'info', title: 'Actualizaciones de MagicPDF',
        message: `MagicPDF ${result.updateInfo.version} está disponible.`,
        detail: 'La instalación espera a que cierres MagicPDF y confirmes los cambios de tus documentos.',
        buttons: ['Descargar actualización', 'Más tarde'], defaultId: 0, cancelId: 1,
      });
      if (response !== 0) return;
      const [installer] = await updater.downloadUpdate();
      if (!installer) throw new Error('No se encontró el instalador descargado.');
      await validateInstaller(installer, publisher);
      ready = true;
      if (!window.isDestroyed()) await notice('La actualización se instalará cuando cierres MagicPDF.');
    } catch (error) {
      console.warn('MagicPDF updater:', error.message);
      if (!window.isDestroyed()) {
        await notice('No se pudo comprobar o verificar la actualización. Puedes consultar la última versión en GitHub Releases.', 'warning');
      }
    } finally {
      busy = false;
    }
  }

  function installOnApprovedClose() {
    if (!ready) return false;
    ready = false;
    updater.quitAndInstall();
    return true;
  }

  return { check, installOnApprovedClose };
}

module.exports = { createWindowsUpdates, readInstallerSignature, verifyInstaller };
