'use strict';

if (process.env.NODE_BACKEND && process.env.NODE_BACKEND !== 'native')
  throw new Error('Non-native backend selected.');

// Make sure we're not loading a third-party module.
if (require.resolve('worker_threads') !== 'worker_threads') {
  const err = new Error('Cannot find module: \'worker_threads\'');
  err.code = 'MODULE_NOT_FOUND';
  throw err;
}

const threads = require('worker_threads');
const socket = require('../internal/socket');

exports.isMainThread = threads.isMainThread;
exports.parentPort = threads.parentPort;
exports.threadId = threads.threadId;
exports.workerData = threads.workerData;
exports.MessagePort = threads.MessagePort;
exports.MessageChannel = threads.MessageChannel;
exports.Worker = threads.Worker;
exports.browser = false;

socket.inject(exports);
