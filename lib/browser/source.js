/*!
 * source.js - script source for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 */

'use strict';

const backend = require('./backend');
const {WORKER_EVAL} = require('./env');

/*
 * Constants
 */

const cache = Object.create(null);

/*
 * Base
 */

function base() {
  if (WORKER_EVAL)
    return new URL(WORKER_EVAL);

  const {document} = global;

  if (!document
      || !document.currentScript
      || typeof document.currentScript.src !== 'string'
      || !document.currentScript.src) {
    return new URL(backend.location);
  }

  return new URL(document.currentScript.src, backend.location);
}

/*
 * Resolve
 */

function resolve(req) {
  return new URL(req, base());
}

/*
 * Require
 */

function _require(req) {
  const url = resolve(req);
  const cached = cache[url.href];

  if (cached)
    return cached.exports;

  if (!backend.importScripts)
    throw new Error('Require is not available.');

  const __dirname = global.__dirname;
  const __filename = global.__filename;
  const _require = global.require;
  const _exports = global.exports;
  const _module = global.module;
  const exports = {};
  const module = { exports: exports };

  cache[url.href] = module;

  global.__dirname = undefined;
  global.__filename = undefined;
  global.require = undefined;
  global.exports = exports;
  global.module = module;

  try {
    backend.importScripts(url.href);
  } catch (e) {
    delete cache[url.href];
    throw e;
  } finally {
    global.__dirname = __dirname;
    global.__filename = __filename;
    global.require = _require;
    global.exports = _exports;
    global.module = _module;
  }

  return module.exports;
}

_require.resolve = (req) => {
  req = String(req);

  if (/^file|https?:/.test(req))
    return req;

  return decodeURI(resolve(req).pathname);
};

/*
 * Expose
 */

exports.base = base;
exports.resolve = resolve;
exports.require = _require;
