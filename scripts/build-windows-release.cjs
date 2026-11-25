const path = require('node:path');
const { execFile } = require('node:child_process');
const { createReadStream } = require('node:fs');
const { access, writeFile } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { promisify } = require('node:util');
const { Arch, Platform, build } = require('electron-builder');
const { build: packageBuild, repository, version: packageVersion } = require('../package.json');
const { readInstallerSignature, verifyInstaller } = require('../electron/windows-updates.cjs');

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function verifyStoreCertificate(thumbprint, publisher) {
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0');
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => name.toLowerCase() !== 'psmodulepath'));
  env.PSModulePath = path.join(powershell, 'Modules');
  // Match the first certificate selected by electron-builder's Windows lookup.
  env.MAGICPDF_WINDOWS_CERT_THUMBPRINT = thumbprint;
  env.MAGICPDF_WINDOWS_PUBLISHER = publisher;
  const { stdout } = await promisify(execFile)(path.join(powershell, 'powershell.exe'), [
    '-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference = 'Stop'; " +
    '$cert = Get-ChildItem -Recurse Cert: -CodeSigningCert | ' +
    'Where-Object Thumbprint -EQ $env:MAGICPDF_WINDOWS_CERT_THUMBPRINT | Select-Object -First 1; ' +
    'if (!$cert) { "missing" } ' +
    'elseif (!$cert.HasPrivateKey) { "no-key" } ' +
    'elseif ($cert.NotBefore -gt (Get-Date) -or $cert.NotAfter -le (Get-Date)) { "expired" } ' +
    'elseif (![string]::Equals($cert.Subject, $env:MAGICPDF_WINDOWS_PUBLISHER, [StringComparison]::Ordinal)) { "publisher" } ' +
    'else { "valid" }',
  ], { env, windowsHide: true, timeout: 15000 });
  switch (stdout.trim()) {
    case 'valid': return;
    case 'missing': throw new Error('Windows no encuentra un certificado de firma de código con esa huella.');
    case 'no-key': throw new Error('Windows encuentra el certificado, pero su clave privada no está disponible.');
    case 'expired': throw new Error('El certificado de firma está fuera de su periodo de validez.');
    case 'publisher': throw new Error('MAGICPDF_WINDOWS_PUBLISHER debe coincidir con el sujeto exacto del certificado.');
    default: throw new Error('No se pudo comprobar el certificado de firma en Windows.');
  }
}

async function main() {
  if (process.platform !== 'win32') throw new Error('Este comando debe ejecutarse en Windows.');

  const localTest = process.argv[2] === '--local-test';
  const localProduction = process.argv[2] === '--local-production';
  const localFeedBuild = localTest || localProduction;
  const signed = localFeedBuild || process.argv.includes('--signed');
  const version = localFeedBuild ? process.argv[3] : packageVersion;
  const publisher = process.env.MAGICPDF_WINDOWS_PUBLISHER?.trim();
  const certificateSha1 = signed && !localTest
    ? process.env.MAGICPDF_WINDOWS_CERT_THUMBPRINT?.trim().toUpperCase()
    : undefined;
  const repositoryName = process.env.GITHUB_REPOSITORY
    || new URL(repository.url).pathname.slice(1).replace(/\.git$/, '');
  if (certificateSha1 && !/^[A-F0-9]{40}$/.test(certificateSha1)) {
    throw new Error('La huella del certificado de Windows debe tener 40 caracteres hexadecimales.');
  }
  if (signed && !publisher) throw new Error('La compilación firmada requiere el nombre del editor.');
  if (localProduction && !certificateSha1) {
    throw new Error('Configura MAGICPDF_WINDOWS_CERT_THUMBPRINT con la huella del certificado de producción instalado en Windows.');
  }
  if (signed && !certificateSha1 && (!process.env.CSC_LINK || !process.env.CSC_KEY_PASSWORD)) {
    throw new Error('Configura CSC_LINK y CSC_KEY_PASSWORD o indica la huella de un certificado de producción instalado en Windows.');
  }
  if (signed && !localFeedBuild && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repositoryName)) {
    throw new Error('El repositorio de GitHub debe tener el formato propietario/repositorio.');
  }

  const [owner, repo] = repositoryName.split('/');
  if (localFeedBuild && !/^\d+\.\d+\.\d+$/.test(version || '')) {
    throw new Error('Indica una versión de prueba con el formato mayor.menor.parche.');
  }
  if (certificateSha1) await verifyStoreCertificate(certificateSha1, publisher);
  const project = path.resolve(__dirname, '..');
  const output = localFeedBuild
    ? path.join(project, 'work', 'firma-windows', `${localProduction ? 'produccion-local' : 'prueba'}-${version}`)
    : path.resolve(process.env.MAGICPDF_RELEASE_OUTPUT || packageBuild.directories.output);
  const githubFeed = { provider: 'github', owner, repo, releaseType: 'release' };
  const localFeed = { provider: 'generic', url: 'http://10.0.2.100:3268/', useMultipleRangeRequest: false };
  const appName = packageBuild.productName;
  const setup = `MagicPDF-Pro-Setup-${version}.exe`;
  if (localTest) process.env.ELECTRON_BUILDER_OFFLINE = 'true';
  await build({
    projectDir: project,
    targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64),
    publish: 'never',
    config: {
      directories: { output },
      publish: signed ? (localFeedBuild ? localFeed : githubFeed) : null,
      ...(signed ? {
        forceCodeSigning: true,
        extraMetadata: { version, windowsUpdatePublisher: publisher },
        win: {
          verifyUpdateCodeSignature: true,
          signtoolOptions: {
            publisherName: publisher,
            signingHashAlgorithms: ['sha256'],
            ...(certificateSha1 ? { certificateSha1 } : {}),
          },
        },
      } : { win: { signExecutable: false } }),
    },
  });

  const files = [setup];
  if (signed) {
    await access(path.join(output, 'win-unpacked', 'resources', 'app-update.yml'));
    for (const file of [path.join(output, 'win-unpacked', `${appName}.exe`), path.join(output, setup)]) {
      if (localTest) {
        const signature = await readInstallerSignature(file);
        // Authenticode trust is established and checked inside the guest.
        if (signature.type !== 'Authenticode' || signature.publisher !== publisher
          || !['Valid', 'NotTrusted', 'UnknownError'].includes(signature.status)) {
          throw new Error(`Firma de prueba incorrecta (${signature.status}) en ${path.basename(file)}.`);
        }
      } else {
        await verifyInstaller(file, publisher, { thumbprint: certificateSha1, requireTimestamp: true });
      }
    }
    files.push(`${setup}.blockmap`, 'latest.yml');
  }

  const checksums = await Promise.all(files.map(async name => `${await sha256(path.join(output, name))}  ${name}`));
  await writeFile(path.join(output, 'SHA256SUMS.txt'), checksums.join('\n') + '\n');
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
