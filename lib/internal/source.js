/*!
 * source.js - script source for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 */

'use strict';

const path = require('path');
const url = require('url');

/*
 * Shim
 */

let {URL, fileURLToPath, pathToFileURL} = url;

if (!fileURLToPath) {
  fileURLToPath = (url) => {
    url = new URL(url);
    return decodeURI(url.pathname);
  };
}

if (!pathToFileURL) {
  pathToFileURL = (file) => {
    file = path.resolve(file);
    return new URL('file://' + encodeURI(file));
  };
}

/*
 * Base
 */

function base(caller) {
  const file = toPath(caller);
  const url = toURL(caller);
  const prepareStackTrace = Error.prepareStackTrace;
  const stackTraceLimit = Error.stackTraceLimit;
  const dummy = {};

  let result = '.';

  Error.prepareStackTrace = (error, stack) => {
    for (let i = 0; i < stack.length; i++) {
      const name = stack[i].getFileName();

      if (name !== file && name !== url)
        continue;

      if (i + 1 < stack.length)
        result = stack[i + 1].getFileName();

      break;
    }
  };

  Error.stackTraceLimit = 20;
  Error.captureStackTrace(dummy);

  dummy.stack;

  Error.prepareStackTrace = prepareStackTrace;
  Error.stackTraceLimit = stackTraceLimit;

  return toURL(result);
}

/*
 * Resolve
 */

function resolve(req, caller) {
  return new URL(req, base(caller));
}

/*
 * Require
 */

function _require(req, caller) {
  return require(resolve(req, caller));
}

_require.resolve = (req, caller) => {
  return toPath(resolve(req, caller));
};

/*
 * Helpers
 */

function toPath(url) {
  url = String(url);

  if (url.startsWith('file:'))
    url = fileURLToPath(url);

  return path.resolve(url);
}

function toURL(file) {
  file = String(file);

  if (file.startsWith('file:'))
    return new URL(file);

  return pathToFileURL(path.resolve(file));
}

/*
 * Expose
 */

exports.base = base;
exports.resolve = resolve;
exports.require = _require;
