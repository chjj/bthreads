'use strict';

const {importScripts} = global;

/*
 * Import
 */

function _importScripts(url) {
  if (typeof url !== 'string')
    throw new TypeError('"url" must be a string.');

  const cache = _importScripts.cache[url];

  if (cache)
    return cache.exports;

  const __dirname = global.__dirname;
  const __filename = global.__filename;
  const _require = global.require;
  const _exports = global.exports;
  const _module = global.module;
  const exports = {};
  const module = { exports: exports };

  _importScripts.cache[url] = module;

  global.__dirname = undefined;
  global.__filename = undefined;
  global.require = undefined;
  global.exports = exports;
  global.module = module;

  try {
    importScripts(url);
  } catch (e) {
    delete _importScripts.cache[url];
  } finally {
    global.__dirname = __dirname;
    global.__filename = __filename;
    global.require = _require;
    global.exports = _exports;
    global.module = _module;
  }

  return module.exports;
}

_importScripts.cache = Object.create(null);

/*
 * Expose
 */

module.exports = _importScripts;
