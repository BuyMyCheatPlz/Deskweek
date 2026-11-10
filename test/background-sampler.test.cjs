"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { relativeLuminance, chooseTheme, sampleImageRegion, sampleWindowBackground } = require("../src/main/windows/background-sampler.cjs");

function image(width, height, pixel) {
  const bitmap = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = pixel(x, y), index = (y * width + x) * 4;
      bitmap[index] = color.b; bitmap[index + 1] = color.g; bitmap[index + 2] = color.r; bitmap[index + 3] = 255;
    }
  }
  return { getSize: () => ({ width, height }), toBitmap: () => bitmap, isEmpty: () => false };
}

test("background luminance chooses contrasting text theme", () => {
  assert.equal(relativeLuminance(0, 0, 0), 0);
  assert.equal(relativeLuminance(255, 255, 255), 1);
  assert.equal(chooseTheme([{ r: 245, g: 245, b: 245 }]).theme, "light");
  assert.equal(chooseTheme([{ r: 18, g: 18, b: 20 }]).theme, "dark");
});

test("background sampler reads a grid across the widget region", () => {
  const display = { x: 0, y: 0, width: 1000, height: 800 };
  const bright = sampleImageRegion(image(100, 80, () => ({ r: 240, g: 240, b: 240 })), { x: 100, y: 80, width: 600, height: 500 }, display);
  assert.equal(bright.theme, "light");
  assert.equal(bright.samples, 25);
  const dark = sampleImageRegion(image(100, 80, () => ({ r: 12, g: 12, b: 14 })), { x: 100, y: 80, width: 600, height: 500 }, display);
  assert.equal(dark.theme, "dark");
  assert.equal(dark.samples, 25);
});

test("sampling excludes the widget from capture and restores protection", async () => {
  let protection = false;
  const win = {
    isDestroyed: () => false,
    isVisible: () => true,
    isContentProtected: () => protection,
    setContentProtection: value => { protection = value; },
  };
  let requestedSize;
  const result = await sampleWindowBackground({
    win,
    bounds: { x: 100, y: 80, width: 600, height: 500 },
    screen: { getDisplayMatching: () => ({ id: 1, size: { width: 1000, height: 800 }, bounds: { x: 0, y: 0, width: 1000, height: 800 } }) },
    desktopCapturer: { getSources: async request => { requestedSize = request.thumbnailSize; return [{ display_id: "1", thumbnail: image(50, 40, () => ({ r: 250, g: 250, b: 250 })) }]; } },
    delayMs: 0,
  });
  assert.equal(result.theme, "light");
  assert.deepEqual(requestedSize, { width: 450, height: 360 });
  assert.equal(protection, false);
});

test("capture failure uses native sampling and restores the original protection", async () => {
  for (const empty of [false, true]) {
    let protectedWindow = false;
    let sampled = 0;
    const result = await sampleWindowBackground({
      win: { isDestroyed: () => false, isVisible: () => true, getBounds: () => ({x: 0,y: 0,width: 100,height: 100}),
        isContentProtected: () => false, setContentProtection: value => { protectedWindow = value; } },
      screen: { getDisplayMatching: () => ({id: 1,size: {width: 100,height: 100},bounds: {x: 0,y: 0,width: 100,height: 100}}) },
      desktopCapturer: { getSources: async () => { if (empty) return []; throw new Error("desktop capture unavailable"); } },
      nativeSampler: ({ bounds }) => { assert.equal(protectedWindow, true); assert.equal(bounds.width, 100); sampled++; return chooseTheme(Array(25).fill({r: 240,g: 240,b: 240})); },
      delayMs: 0,
    });
    assert.equal(sampled, 1);
    assert.equal(result.theme, "light");
    assert.equal(protectedWindow, false);
  }
});
