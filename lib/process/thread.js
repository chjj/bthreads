'use strict';

const listeners = process.listeners('warning');

process.removeAllListeners('warning');

const socket = require('../internal/socket');
const {MessagePortBase, MessageChannel} = require('./common');
const Worker = require('./worker');
const Parent = require('./parent');
const isEval = process.env.BTHREADS_WORKER_EVAL === '1';
const parent = new Parent();

exports.isMainThread = false;
exports.parentPort = parent;
exports.threadId = parent._threadId;
exports.workerData = parent._workerData;
exports.MessagePort = MessagePortBase;
exports.MessageChannel = MessageChannel;
exports.Worker = Worker;

exports.backend = 'child_process';
exports.browser = false;
exports.source = (!isEval && require.main) ? require.main.filename : null;
exports.process = process;

socket.inject(exports);

for (const listener of listeners)
  process.on('warning', listener);
