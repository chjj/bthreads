/*!
 * eval.js - eval context for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 */

/* global __bthreads_polyfill_scope, __bthreads_importScripts */
/* eslint camelcase: "off" */

'use strict';

const threads = require('./thread');
const {parentPort} = threads;

/*
 * Require
 */

function _require(location) {
  switch (location) {
    case 'assert':
      return require('assert');
    case 'async_hooks': // Empty.
      return require('async_hooks');
    case 'buffer':
      return require('buffer');
    case 'bthreads':
      return threads;
    case 'child_process': // Empty.
      return require('child_process');
    case 'cluster': // Empty.
      return require('cluster');
    case 'constants': // Extra.
      return require('constants');
    case 'console':
      return require('console');
    case 'crypto': // Extra.
      return require('crypto');
    case 'dgram': // Empty.
      return require('dgram');
    case 'dns': // Empty.
      return require('dns');
    case 'domain': // Extra.
      return require('domain');
    case 'events':
      return require('events');
    case 'fs': // Empty.
      return require('fs');
    case 'http': // Extra.
      return require('http');
    case 'http2': // Extra.
      return require('http2');
    case 'https': // Extra.
      return require('https');
    case 'inspector': // Empty.
      return require('inspector');
    case 'module': // Empty.
      return require('module');
    case 'net': // Empty.
      return require('net');
    case 'os': // Extra.
      return require('os');
    case 'path': // Extra.
      return require('path');
    case 'process':
      return require('process');
    case 'perf_hooks': // Empty.
      return require('perf_hooks');
    case 'punycode': // Extra.
      return require('punycode');
    case 'querystring': // Extra.
      return require('querystring');
    case 'readline': // Empty.
      return require('readline');
    case 'repl': // Empty.
      return require('repl');
    case 'stream': // Extra.
      return require('stream');
    case 'string_decoder':
      return require('string_decoder');
    case 'sys':
      return require('sys');
    case 'timers':
      return require('timers');
    case 'tls': // Empty.
      return require('tls');
    case 'tty': // Extra.
      return require('tty');
    case 'url': // Extra.
      return require('url');
    case 'util':
      return require('util');
    case 'v8': // Empty.
      return require('v8');
    case 'vm': // Extra.
      return require('vm');
    case 'worker_threads':
      return threads;
    case 'zlib': // Extra.
      return require('zlib');
    default:
      return require(location);
  }
}

_require.cache = require.cache;
_require.extensions = require.extensions;
_require.main = null;
_require.resolve = require.resolve;
_require.resolve.paths = require.resolve
  ? require.resolve.paths
  : null;

/*
 * Scripts
 */

function runScript(code, args) {
  const names = [];
  const values = [global];

  for (const name of Object.keys(args)) {
    names.push(name);
    values.push(args[name]);
  }

  if (typeof __bthreads_polyfill_scope === 'object') {
    names.push('__bthreads_polyfill_scope');
    values.push(__bthreads_polyfill_scope);
  }

  if (typeof __bthreads_importScripts === 'function') {
    names.push('__bthreads_importScripts');
    values.push(__bthreads_importScripts);
  }

  const func = new Function(names.join(','), code);

  return func.call(...values);
}

function evalScript(name, code) {
  const file = '/' + name;
  const exports = {};

  const module = {
    id: name,
    exports,
    parent: undefined,
    filename: file,
    loaded: false,
    children: [],
    paths: ['/'],
    require: _require
  };

  process.mainModule = undefined;
  require.main = undefined;

  if (typeof __bthreads_polyfill_scope !== 'object') {
    global.__filename = name;
    global.__dirname = '.';
    global.exports = exports;
    global.module = module;
    global.require = _require;
  }

  runScript(code, {
    // Globals
    global,
    self: global,
    Buffer,
    console,
    process,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    setImmediate,
    clearImmediate,

    // Module
    __filename: name,
    __dirname: '.',
    exports,
    module,
    require: _require
  });
}

/*
 * Execute
 */

// Wait for code to come in.
parentPort.onmessage = (code) => {
  parentPort.onmessage = null;
  setImmediate(() => {
    try {
      evalScript('[worker eval]', code);
    } catch (e) {
      parentPort._exception(e);
    }
  });
};
