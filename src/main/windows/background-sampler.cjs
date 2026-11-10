"use strict";

function srgbToLinear(value) {
  const channel = Math.max(0, Math.min(255, Number(value) || 0)) / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(red, green, blue) {
  return 0.2126 * srgbToLinear(red) + 0.7152 * srgbToLinear(green) + 0.0722 * srgbToLinear(blue);
}

function chooseTheme(samples) {
  const values = (Array.isArray(samples) ? samples : [])
    .map(sample => typeof sample === "number" ? sample : relativeLuminance(sample?.r, sample?.g, sample?.b))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (!values.length) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  const luminance = median * 0.7 + mean * 0.3;
  const darkText = relativeLuminance(29, 29, 31);
  const lightText = relativeLuminance(245, 245, 247);
  const darkContrast = (luminance + 0.05) / (darkText + 0.05);
  const lightContrast = (lightText + 0.05) / (luminance + 0.05);
  const theme = darkContrast >= lightContrast ? "light" : "dark";
  const best = Math.max(darkContrast, lightContrast);
  const other = Math.min(darkContrast, lightContrast);
  return {
    theme,
    luminance: Number(luminance.toFixed(4)),
    contrast: Number(best.toFixed(2)),
    confidence: Number(((best - other) / best).toFixed(3)),
    samples: values.length,
  };
}

function sampleImageRegion(image, windowBounds, displayBounds) {
  const size = image?.getSize?.();
  const bitmap = image?.toBitmap?.();
  if (!size?.width || !size?.height || !bitmap?.length) throw new Error("桌面截图不可用");
  const bounds = displayBounds || { x: 0, y: 0, width: size.width, height: size.height };
  const toX = value => (value - bounds.x) / Math.max(1, bounds.width) * size.width;
  const toY = value => (value - bounds.y) / Math.max(1, bounds.height) * size.height;
  const left = Math.max(0, Math.min(size.width - 1, Math.round(toX(windowBounds.x + windowBounds.width * 0.08))));
  const right = Math.max(left + 1, Math.min(size.width - 1, Math.round(toX(windowBounds.x + windowBounds.width * 0.92))));
  const top = Math.max(0, Math.min(size.height - 1, Math.round(toY(windowBounds.y + windowBounds.height * 0.08))));
  const bottom = Math.max(top + 1, Math.min(size.height - 1, Math.round(toY(windowBounds.y + windowBounds.height * 0.92))));
  const columns = 5, rows = 5, radius = 1, samples = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const centerX = Math.round(left + (right - left) * (column + 0.5) / columns);
      const centerY = Math.round(top + (bottom - top) * (row + 0.5) / rows);
      let red = 0, green = 0, blue = 0, count = 0;
      for (let y = Math.max(0, centerY - radius); y <= Math.min(size.height - 1, centerY + radius); y += 1) {
        for (let x = Math.max(0, centerX - radius); x <= Math.min(size.width - 1, centerX + radius); x += 1) {
          const index = (y * size.width + x) * 4;
          blue += bitmap[index]; green += bitmap[index + 1]; red += bitmap[index + 2]; count += 1;
        }
      }
      if (count) samples.push({ r: red / count, g: green / count, b: blue / count });
    }
  }
  return chooseTheme(samples);
}

// GDI needs no capture-worker desktop reassignment (Electron can fail that with ERROR_BUSY).
// Only sample 25 pixels; never retain a second full-screen capture.
function sampleNativeRegion({ screen, bounds }) {
  if (process.platform !== "win32" || typeof screen.dipToScreenPoint !== "function") return null;
  const koffi = require("koffi"), user32 = koffi.load("user32.dll"), gdi32 = koffi.load("gdi32.dll");
  const getDC = user32.func("void * __stdcall GetDC(void * hwnd)");
  const releaseDC = user32.func("int __stdcall ReleaseDC(void * hwnd, void * hdc)");
  const getPixel = gdi32.func("uint32 __stdcall GetPixel(void * hdc, int x, int y)");
  const dc = getDC(null);
  if (!dc) return null;
  try {
    const samples = [];
    for (let row = 0; row < 5; row++) {
      for (let column = 0; column < 5; column++) {
        const point = screen.dipToScreenPoint({
          x: Math.round(bounds.x + bounds.width * (0.08 + 0.84 * (column + 0.5) / 5)),
          y: Math.round(bounds.y + bounds.height * (0.08 + 0.84 * (row + 0.5) / 5)),
        });
        const color = getPixel(dc, point.x, point.y);
        if (color === 0xffffffff) return null;
        samples.push({ r: color & 255, g: (color >>> 8) & 255, b: (color >>> 16) & 255 });
      }
    }
    return chooseTheme(samples);
  } finally { releaseDC(null, dc); }
}

async function sampleWindowBackground({ win, screen, desktopCapturer, bounds, delayMs = 180, nativeSampler = sampleNativeRegion }) {
  if (!win || win.isDestroyed() || !win.isVisible()) return null;
  const windowBounds = bounds || win.getBounds();
  const display = screen.getDisplayMatching(windowBounds);
  const scale = Math.min(640 / display.size.width, 360 / display.size.height, 1);
  const thumbnailSize = { width: Math.max(1, Math.round(display.size.width * scale)), height: Math.max(1, Math.round(display.size.height * scale)) };
  const wasProtected = typeof win.isContentProtected === "function" ? win.isContentProtected() : false;
  try {
    win.setContentProtection(true);
    await new Promise(resolve => setTimeout(resolve, delayMs));
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize, fetchWindowIcons: false }).catch(() => []);
    const source = sources.find(item => String(item.display_id) === String(display.id)) || sources[0];
    if (!source || source.thumbnail.isEmpty()) {
      if (win.isDestroyed() || !win.isVisible()) return null;
      return nativeSampler({ screen, bounds: windowBounds });
    }
    return sampleImageRegion(source.thumbnail, windowBounds, display.bounds);
  } finally {
    try { win.setContentProtection(wasProtected); } catch { /* window may have closed during capture */ }
  }
}

module.exports = { relativeLuminance, chooseTheme, sampleImageRegion, sampleWindowBackground };
