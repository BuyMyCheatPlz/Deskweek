"use strict";

const LIMITS = { minWidth: 420, minHeight: 280, maxWidth: 1600, maxHeight: 1000 };
const RESIZE_EDGES = new Set(["n", "s", "e", "w", "ne", "nw", "se", "sw"]);
function intersection(a, b) {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}
function fitBounds(bounds, displays, defaults = { x: 80, y: 80, width: 880, height: 690 }, limits = LIMITS) {
  const value = bounds && ["x", "y", "width", "height"].every(key => Number.isFinite(bounds[key])) ? bounds : defaults;
  const display = displays.reduce((best, item) => intersection(value, item.workArea) > intersection(value, best.workArea) ? item : best, displays[0]);
  const a = display.workArea;
  const width = Math.round(Math.min(a.width, limits.maxWidth, Math.max(limits.minWidth, value.width)));
  const height = Math.round(Math.min(a.height, limits.maxHeight, Math.max(limits.minHeight, value.height)));
  return { x: Math.round(Math.max(a.x, Math.min(a.x + a.width - width, value.x))), y: Math.round(Math.max(a.y, Math.min(a.y + a.height - height, value.y))), width, height };
}
function resizeBounds(start, cursorDelta, edge, displays) {
  if (!RESIZE_EDGES.has(edge)) throw new Error("无效的缩放方向");
  const a = displays.reduce((best, item) => intersection(start, item.workArea) > intersection(start, best.workArea) ? item : best, displays[0]).workArea;
  let { x, y, width, height } = start;
  if (edge.includes("e")) width += cursorDelta.x;
  if (edge.includes("w")) width -= cursorDelta.x;
  if (edge.includes("s")) height += cursorDelta.y;
  if (edge.includes("n")) height -= cursorDelta.y;
  width = Math.min(a.width, LIMITS.maxWidth, Math.max(Math.min(LIMITS.minWidth, a.width), width));
  height = Math.min(a.height, LIMITS.maxHeight, Math.max(Math.min(LIMITS.minHeight, a.height), height));
  if (edge.includes("w")) { width = Math.min(width, start.x + start.width - a.x); x = start.x + start.width - width; }
  else width = Math.min(width, a.x + a.width - x);
  if (edge.includes("n")) { height = Math.min(height, start.y + start.height - a.y); y = start.y + start.height - height; }
  else height = Math.min(height, a.y + a.height - y);
  return fitBounds({ x, y, width, height }, displays);
}
module.exports = { fitBounds, resizeBounds, LIMITS, RESIZE_EDGES, intersection };
