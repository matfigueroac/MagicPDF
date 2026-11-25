import fs from "node:fs/promises";
import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  StandardFonts,
  rgb,
} from "pdf-lib";
async function save(file: string, pdf: PDFDocument) {
  const tmp = file + ".pro-writing";
  try {
    await fs.writeFile(tmp, await pdf.save());
    await fs.rename(tmp, file);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}
export async function readForms(file: string) {
  const pdf = await PDFDocument.load(await fs.readFile(file)),
    form = pdf.getForm();
  if (form.hasXFA())
    throw new Error(
      "Este documento usa XFA. Pro Lite admite formularios AcroForm.",
    );
  return form
    .getFields()
    .map((f) => ({
      name: f.getName(),
      readOnly: f.isReadOnly(),
      type:
        f instanceof PDFTextField
          ? "text"
          : f instanceof PDFCheckBox
            ? "checkbox"
            : f instanceof PDFDropdown
              ? "dropdown"
              : f instanceof PDFOptionList
                ? "list"
                : f instanceof PDFRadioGroup
                  ? "radio"
                  : "unsupported",
      value:
        f instanceof PDFTextField
          ? f.getText() || ""
          : f instanceof PDFCheckBox
            ? f.isChecked()
            : f instanceof PDFRadioGroup
              ? f.getSelected() || ""
              : f instanceof PDFDropdown || f instanceof PDFOptionList
                ? f.getSelected()
                : null,
      options:
        f instanceof PDFDropdown ||
        f instanceof PDFOptionList ||
        f instanceof PDFRadioGroup
          ? f.getOptions()
          : [],
      multiline: f instanceof PDFTextField && f.isMultiline(),
    }));
}
export async function writeForms(
  file: string,
  values: Record<string, unknown>,
) {
  if (!values || typeof values !== "object" || Array.isArray(values))
    throw new Error("Campos inválidos");
  const pdf = await PDFDocument.load(await fs.readFile(file)),
    form = pdf.getForm();
  for (const [name, value] of Object.entries(values)) {
    const field = form.getField(name);
    if (field.isReadOnly()) continue;
    if (field instanceof PDFTextField && typeof value === "string")
      field.setText(value);
    else if (field instanceof PDFCheckBox && typeof value === "boolean")
      value ? field.check() : field.uncheck();
    else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      const selected = Array.isArray(value) ? value : [value];
      if (
        selected.some(
          (v) => typeof v !== "string" || !field.getOptions().includes(v),
        )
      )
        throw new Error("Opción inválida: " + name);
      if (selected.length) field.select(selected as string[]);
      else field.clear();
    } else if (field instanceof PDFRadioGroup && typeof value === "string") {
      if (value) field.select(value);
      else field.clear();
    } else throw new Error("Tipo de campo no admitido: " + name);
  }
  form.updateFieldAppearances(await pdf.embedFont(StandardFonts.Helvetica));
  await save(file, pdf);
}
export async function addTextBox(file: string, options: any) {
  const {
    page: pageNumber,
    text,
    x,
    y,
    width,
    height,
    size,
    font: family,
    align,
    color,
  } = options;
  if (
    ![pageNumber, x, y, width, height, size].every(Number.isFinite) ||
    !Number.isInteger(pageNumber) ||
    typeof text !== "string" ||
    !text.trim() ||
    text.length > 20000 ||
    width < 10 ||
    height < 10 ||
    size < 6 ||
    size > 150 ||
    x < 0 ||
    y < 0 ||
    !/^#[a-f0-9]{6}$/i.test(color)
  )
    throw new Error("Revisa el texto, posición, tamaño y color.");
  const pdf = await PDFDocument.load(await fs.readFile(file));
  if (pageNumber < 1 || pageNumber > pdf.getPageCount())
    throw new Error("Página inválida");
  const page = pdf.getPage(pageNumber - 1),
    crop = page.getCropBox();
  if (x + width > crop.width || y + height > crop.height)
    throw new Error("El cuadro debe estar dentro de la página.");
  const faces: Record<string, StandardFonts> = {
    sans: StandardFonts.Helvetica,
    serif: StandardFonts.TimesRoman,
    mono: StandardFonts.Courier,
  };
  const font = await pdf.embedFont(faces[family] || StandardFonts.Helvetica),
    lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (font.widthOfTextAtSize(word, size) > width)
        throw new Error(
          "Hay una palabra más ancha que el cuadro. Amplía el ancho o reduce el tamaño.",
        );
      const next = line ? line + " " + word : word;
      if (font.widthOfTextAtSize(next, size) > width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  const leading = size * 1.25;
  if (lines.length * leading > height)
    throw new Error(
      "El texto no cabe en el alto indicado. Amplía el cuadro o reduce el tamaño.",
    );
  const c = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
  lines.forEach((line, i) => {
    const delta = width - font.widthOfTextAtSize(line, size);
    page.drawText(line, {
      x:
        crop.x +
        x +
        (align === "right" ? delta : align === "center" ? delta / 2 : 0),
      y: crop.y + crop.height - y - size - i * leading,
      size,
      font,
      color: rgb(c[0], c[1], c[2]),
    });
  });
  await save(file, pdf);
}
