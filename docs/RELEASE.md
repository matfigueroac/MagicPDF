# Publicación de MagicPDF para Windows

## Preparar la versión

1. Actualiza la versión en `package.json` y `package-lock.json` con `npm version patch --no-git-tag-version`. Ajusta el incremento según los cambios.
2. Sube el cambio a `main` y comprueba el flujo **Windows**. Este compila la aplicación y ejecuta las pruebas de integración, recuperación y actualizaciones.
3. Desde **Actions → Windows → Run workflow**, ejecuta el flujo en `main` con la opción de firma y descarga el artefacto **MagicPDF-Windows-x64-signed**.

El trabajo de firma lee `WINDOWS_CSC_LINK` y `WINDOWS_CSC_KEY_PASSWORD` del entorno de GitHub **windows-release**. Esa configuración admite un certificado Authenticode en formato PFX mediante el mecanismo `CSC_LINK` de electron-builder. Configura también la variable `WINDOWS_PUBLISHER` con el sujeto exacto del certificado que devuelve `(Get-AuthenticodeSignature -LiteralPath 'ruta-del-ejecutable-firmado').SignerCertificate.Subject`. Conserva la misma identidad de editor al renovar el certificado. [Firma en electron-builder](https://www.electron.build/docs/features/code-signing/)

Sin la opción de firma, el flujo genera un instalador preliminar para GitHub. Para generarlo localmente usa `npm ci` y `npm run dist:release` en Windows x64. Adjunta el EXE, `SHA256SUMS.txt` y `dist-licenses/Licencias-de-terceros.txt` a la versión preliminar. Indica que el EXE se distribuye sin firma y que las actualizaciones de esa edición se instalan manualmente.

## Firmar localmente para distribución

En Windows x64, ejecuta `npm ci` y `npm run build`. Configura `MAGICPDF_WINDOWS_PUBLISHER` con el sujeto exacto del certificado. Si el certificado está en el almacén de Windows y su clave está accesible para SignTool, configura `MAGICPDF_WINDOWS_CERT_THUMBPRINT` con su huella de 40 caracteres. Para un PFX usa `CSC_LINK` y `CSC_KEY_PASSWORD` en la sesión de terminal. Ejecuta `node scripts/build-windows-release.cjs --signed`. Con una huella configurada, el script comprueba antes de empaquetar que Windows encuentra el certificado con ese sujeto, vigencia y clave privada asociada. Los artefactos de distribución quedan en `release/` y Windows debe validar la firma con sello de tiempo del instalador y de la aplicación. [Opciones de SignTool en electron-builder 26](https://www.electron.build/v26/docs/api/app-builder-lib.interface.windowssigntoolconfiguration/)

## Validar dos versiones en local

1. Configura el sujeto y la huella del certificado de producción. Ejecuta `node scripts/build-windows-release.cjs --local-production <versión>` para cada versión. Quedan en `work/firma-windows/produccion-local-<versión>`.
2. En el anfitrión ejecuta `node scripts/serve-windows-update-test.cjs <versión-inicial> <versión-nueva>`. Sirve ambos instaladores y mapas de bloques en el canal local de la VM, con soporte para descargas diferenciales.
3. En la VM limpia, descarga `http://10.0.2.100:3268/verify-windows-update.ps1`. Ejecútalo desde PowerShell con `-BaseVersion <versión-inicial> -TargetVersion <versión-nueva> -Publisher '<sujeto>' -Thumbprint '<huella>'`. El verificador usa el almacén de confianza habitual de Windows. Comprueba el editor, la huella y el sello de tiempo antes de instalar.
4. Sigue en la aplicación la descarga y el cierre que indica el verificador. Confirma que la versión nueva vuelve a abrir, que el canal informa que está al día y que el informe valida la firma y los datos de prueba.

Para ensayar con una firma de prueba, sigue estos pasos.

1. Ejecuta `npm run build`. Configura `CSC_LINK`, `CSC_KEY_PASSWORD` y `MAGICPDF_WINDOWS_PUBLISHER` para un certificado desechable de firma de código.
2. Genera dos versiones consecutivas con `node scripts/build-windows-release.cjs --local-test <versión>`. Cada comando genera el instalador, su mapa de bloques, el manifiesto y las sumas SHA-256 en `work/firma-windows/prueba-<versión>`.
3. Usa un Windows x64 limpio en una máquina virtual. Importa allí solo el certificado público de prueba y verifica el instalador con `Get-AuthenticodeSignature`. Sirve por HTTP el `latest.yml` de la versión nueva, ambos mapas de bloques y el instalador de destino. El servidor necesita aceptar peticiones de rangos de bytes. El instalador de prueba consulta `http://10.0.2.100:3268/` desde el invitado.
4. Instala la versión anterior. En **Inicio → Buscar actualizaciones…**, descarga la versión nueva y cierra MagicPDF. Comprueba que se instaló la nueva versión, que Windows valida su firma y que se conservan los datos del usuario.

Genera los archivos de distribución con el certificado de producción y el canal de GitHub. Los instaladores de este ensayo usan un canal local y un certificado de corta duración.

## Preparar Microsoft Store

La [guía de Microsoft Store](MICROSOFT-STORE.md) reúne la ficha en español, las capturas, la política de privacidad y las notas para certificación.

1. La compilación usa la identidad reservada de **MagicPDF Pro** (`matfc.MagicPDFPro`, editor visible `matfc`). Puedes contrastarla con la [identidad del producto en Partner Center](https://partner.microsoft.com/es-es/dashboard/products/9N3RHFGLFV4V/identity).
2. Ejecuta `npm run build` y `node scripts/build-windows-store.cjs` en Windows x64. El MSIX queda en `release/store/` junto a su SHA-256. El manifiesto declara Windows 10 22H2 o posterior, arquitectura x64 y la capacidad `runFullTrust` de Electron.
3. Si quieres obtener la certificación antes del lanzamiento, selecciona publicación manual en las opciones del envío antes de enviarlo a revisión. La configuración predeterminada inicia la publicación cuando se aprueba el envío. [Opciones del envío](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/manage-submission-options)
4. Cuando decidas lanzar la aplicación, selecciona **Publicar ahora**. Microsoft firma el MSIX durante la fase de publicación. Las actualizaciones de esta edición se distribuyen por Microsoft Store. [Fases de certificación y publicación](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-certification-process)

Para ensayar localmente, genera dos versiones con `node scripts/build-windows-store.cjs --preview <versión>`. Se guardan en `work/firma-windows/store-preview-<versión>` con identidad `MagicPDF.Preview` y editor `CN=MagicPDF Store QA`. Firma ambos MSIX con un certificado desechable de ese sujeto. En una VM, importa solo su parte pública a `LocalMachine\TrustedPeople`, instala la versión base con `Add-AppxPackage -Path <archivo.msix>` y aplica la versión nueva con el mismo comando. Verifica el arranque, la nueva versión y la conservación de datos. [Firma de paquetes de prueba](https://learn.microsoft.com/en-us/windows/msix/package/create-certificate-package-signing)

## Probar y publicar

1. En Windows limpio, instala el ejecutable. Abre un PDF, guarda una edición y prueba el OCR sin conexión. Confirma el editor del instalador y comprueba el hash contra `SHA256SUMS.txt`.
2. Crea un borrador de release con la etiqueta `v<versión>` apuntando al commit probado. Añade un resumen de cambios y adjunta estos archivos del mismo build.

   - `MagicPDF-Pro-Setup-<versión>.exe`
   - `MagicPDF-Pro-Setup-<versión>.exe.blockmap`
   - `latest.yml`
   - `SHA256SUMS.txt`
   - `Licencias-de-terceros.txt` de `dist-licenses/`

3. Publica la primera versión firmada para habilitar la descarga. Antes de publicar una segunda versión para todos, prueba la transición desde la versión anterior con dos compilaciones firmadas en un repositorio público de pruebas. Un borrador de GitHub no alimenta el canal de usuarios. [Releases de GitHub](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository) · [Actualizaciones de electron-builder](https://www.electron.build/docs/features/auto-update/)
4. Tras publicar, descarga el instalador desde GitHub con una sesión sin autenticar. Desde la versión anterior, prueba **Buscar actualizaciones…**, descarga la nueva y verifica que cancelar el cierre mantiene abierto el documento. Al confirmar el cierre, verifica que se instala la nueva versión y que los PDF guardados se siguen abriendo.

## Procedencia de PDFCraft

MagicPDF incluye `bin/pdfcraft-cli.exe` de PDFCraft 0.4.0 para Windows x64. Coincide con el ejecutable del archivo `pdfcraft-0.4.0-windows-x64-portable.zip` publicado por el proyecto. Su SHA-256 es `e92d20827e0b23efdcccb9aa799d3e99a695bc3412bcffc99f36724c01379ca7`. El instalador conserva las [licencias y avisos](../bin/licenses) en `resources/bin/licenses`. El archivo `NOTICE` corresponde a la etiqueta `v0.4.0`. [Release original de PDFCraft](https://github.com/storytold/pdfcraft/releases/tag/v0.4.0)
