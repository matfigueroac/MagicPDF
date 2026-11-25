# MagicPDF en Microsoft Store

## Ficha en español

**Nombre reservado**  
MagicPDF Pro

**Descripción breve**  
Lee, anota y organiza PDF. Convierte escaneos en texto seleccionable con OCR sin conexión.

**Descripción**  
MagicPDF Pro es un lector y editor de PDF para Windows. Abre varios documentos en pestañas. Resalta y subraya texto, añade notas y figuras, y administra las anotaciones desde el panel de capas. Ordena, gira, combina o divide páginas y rellena formularios PDF compatibles.

Convierte escaneos en documentos con texto seleccionable mediante OCR local en español e inglés. Puedes copiar el texto o exportarlo a TXT. El procesamiento ocurre en tu equipo.

**Características**

- Lectura con búsqueda, zoom y miniaturas.
- Resaltado, subrayado, cuadros de texto y dibujo con capas.
- Reordenación y rotación de páginas, combinación y división de PDF.
- OCR local en español e inglés y exportación de texto.

**Configuración propuesta**  
Gratis. Windows 10 22H2 o Windows 11, arquitectura x64. Selecciona escritorio como familia de dispositivos y agrega la ficha en español.

**Capturas de escritorio**  
Cuatro PNG de 1600 × 1000, capturados en MagicPDF con un informe ficticio.

- [Lector con miniaturas de página](images/store/lector.png)
- [Resaltado de texto sobre el PDF](images/store/resaltar.png)
- [Organización de páginas](images/store/organizar.png)
- [Vista previa de texto y exportación a TXT](images/store/exportar-texto.png)

**Privacidad y soporte**  
Usa la URL pública del archivo [PRIVACIDAD.md](PRIVACIDAD.md) y la página de [incidencias de MagicPDF](https://github.com/matfigueroac/MagicPDF/issues) cuando el repositorio esté publicado. Comprueba que ambas páginas abren sin iniciar sesión antes de enviarlas a Microsoft.

## Notas para certificación

MagicPDF Pro es una aplicación de escritorio Electron/Win32. Utiliza `runFullTrust` para ejecutar su proceso de escritorio, abrir y guardar los archivos que selecciona el usuario y ejecutar PDFCraft, el motor local de procesamiento de PDF incluido en el paquete.

No requiere inicio de sesión. Para probarla, abre el [PDF de ejemplo](ejemplo-magicpdf.pdf) desde **Inicio → Abrir PDF**. Resalta texto en la primera página. Abre **Organizar → Organizar páginas** y rota o mueve una página. Usa **Inicio → Guardar como…** para verificar que el PDF exportado conserva los cambios. Para probar el OCR, abre un PDF escaneado y elige **Herramientas → OCR local**. Los datos de español e inglés vienen en el paquete.

En las notas del envío, añade la URL pública del PDF de ejemplo y comprueba que permite descargarlo sin sesión.

## Preparación del envío

1. **MagicPDF Pro** se reservó el 25 de noviembre de 2026 en la cuenta de RedBIM. Su Store ID es `9N3RHFGLFV4V` y su familia de paquetes es `matfc.MagicPDFPro_0rjpaxqx2cz7r`. Partner Center da tres meses desde la reserva para enviar la aplicación. [Identidad del producto](https://partner.microsoft.com/es-es/dashboard/products/9N3RHFGLFV4V/identity)
2. Genera el paquete con esa identidad según la [guía de compilación](RELEASE.md#preparar-microsoft-store) y verifica la suma SHA-256. Conserva la misma identidad y aumenta la versión en actualizaciones posteriores.
3. En el borrador, adjunta el MSIX x64, las capturas y la ficha. Completa precio, disponibilidad, clasificación de edad y notas de certificación. [Requisitos del envío](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/create-app-submission)
4. Si se autoriza el envío para revisión con lanzamiento pendiente, activa la publicación manual antes de enviarlo. Microsoft firma el MSIX durante la publicación. [Opciones de publicación](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/manage-submission-options) · [Fases del proceso](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-certification-process)
