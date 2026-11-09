"use strict";
// Minimal main-process translation shim used by the adapted desktop attachment code.
let current = "zh";
function translate(_language, key, params = []) {
  return String(key).replace(/\{(\d+)\}/g, (_, index) => params[Number(index)] ?? `{${index}}`);
}
function resolve(_setting, _locale) { return current; }
function setLanguage(language) { current = language || "zh"; }
function getLanguage() { return current; }
function tr(key, params) { return translate(current, key, params); }
module.exports = { tr, resolve, setLanguage, getLanguage };
