import { expect, type Page } from "@playwright/test";

export async function setReaderZoom100(page: Page, pageWidthPoints: number) {
  await page.getByLabel("Zoom", { exact: true }).selectOption("1");
  const renderedPage = page.locator(".reader .page").first();
  // PDF.js can resize the old canvas while rendering the new one.
  await expect.poll(() => renderedPage.evaluate((element, widthPoints) => {
    const canvas = element.querySelector("canvas");
    const expectedWidth = widthPoints * (96 / 72) * devicePixelRatio;
    return !!canvas && Math.abs(canvas.width - expectedWidth) <= 2;
  }, pageWidthPoints)).toBe(true);
}
