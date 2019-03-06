/*!
 * index.js - worker_threads backend for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 */

'use strict';

if (process.env.BTHREADS_BACKEND
    && process.env.BTHREADS_BACKEND !== 'worker_threads'
    && process.env.BTHREADS_BACKEND !== 'web_workers') {
  throw new Error('Non-native backend selected.');
}

// Make sure we're not loading a third-party module.
if (require.resolve('worker_threads') !== 'worker_threads') {
  const err = new Error('Cannot find module: \'worker_threads\'');
  err.code = 'MODULE_NOT_FOUND';
  throw err;
}

const threads = require('worker_threads');
const socket = require('../internal/socket');
const {bindDefault, getter} = require('../internal/utils');

// Note that `require.main` is not set at all during evaling.
const isEval = !process.mainModule || process.mainModule.id === '[worker eval]';

exports.isMainThread = threads.isMainThread;
exports.parentPort = threads.parentPort;
exports.threadId = threads.threadId;
exports.workerData = threads.isMainThread ? null : threads.workerData;
exports.MessagePort = threads.MessagePort;
exports.MessageChannel = threads.MessageChannel;
exports.Worker = threads.Worker;
exports.importScripts = null;

exports.backend = 'worker_threads';
exports.source = (!isEval && require.main) ? require.main.filename : null;
exports.browser = false;

getter(exports, 'process', () => require('../process'));

exports.exit = process.exit.bind(process);

getter(exports, 'stdin', () => process.stdin);
getter(exports, 'stdout', () => process.stdout);
getter(exports, 'stderr', () => process.stderr);
getter(exports, 'console', () => console);

socket.inject(exports);

if (!threads.isMainThread) {
  bindDefault(process, 'unhandledRejection', (err) => {
    if (!(err instanceof Error))
      err = new Error('Unhandled rejection: ' + err);

    throw err;
  });
}
