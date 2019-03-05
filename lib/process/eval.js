/*!
 * eval.js - eval context for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 *
 * Resources:
 *   https://github.com/nodejs/node/blob/84ebaaa/lib/internal/main/worker_thread.js#L98
 *   https://github.com/nodejs/node/blob/84ebaaa/lib/internal/process/execution.js#L36
 *   https://github.com/nodejs/node/blob/84ebaaa/lib/internal/modules/cjs/loader.js#L424
 *   https://github.com/nodejs/node/blob/da13c44/lib/internal/bootstrap/node.js#L725
 */

'use strict';

const path = require('path');
const vm = require('vm');
const {parentPort} = require('./');

/*
 * Helpers
 */

function tryGetCwd() {
  try {
    return process.cwd();
  } catch (e) {
    return path.dirname(process.execPath);
  }
}

function nodeModulePaths(root) {
  const paths = [];

  for (;;) {
    if (path.basename(root) !== 'node_modules')
      paths.push(path.join(root, 'node_modules'));

    const next = path.dirname(root);

    if (next === root)
      break;

    root = next;
  }

  return paths;
}

function evalScript(name, body) {
  const cwd = tryGetCwd();
  const paths = nodeModulePaths(cwd);

  module.id = name;
  module.filename = path.join(cwd, name);
  module.paths.length = 0;
  module.paths.push(...paths);

  // These are better for compat,
  // but I feel they may break
  // things unnecessarily:
  //
  // module.parent = undefined;
  // module.loaded = false;
  //
  // require.main = undefined;
  //
  // Should be at top of file,
  // above all requires:
  //
  // process.mainModule = undefined;

  global.__filename = name;
  global.__dirname = '.';
  global.exports = exports;
  global.module = module;
  global.require = require;

  vm.runInThisContext(body, {
    filename: name,
    displayErrors: true
  });
}

/*
 * Execute
 */

// Wait for code to come in.
parentPort.onmessage = (code) => {
  parentPort.onmessage = null;
  evalScript('[worker eval]', code);
};
