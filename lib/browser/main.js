/*!
 * main.js - main thread entry point for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 */

'use strict';

const socket = require('../internal/socket');
const backend = require('./backend');
const common = require('./common');
const Console = require('./console');
const source = require('./source');
const stdio = require('./stdio');
const stream = require('./stream');
const Worker = require('./worker');
const {MessagePortBase, MessageChannel} = common;

exports.isMainThread = true;
exports.parentPort = null;
exports.threadId = 0;
exports.workerData = null;
exports.MessagePort = MessagePortBase;
exports.MessageChannel = MessageChannel;
exports.Worker = Worker;
exports.moveMessagePortToContext = null;
exports.receiveMessageOnPort = null;
exports.SHARE_ENV = Symbol.for('nodejs.worker_threads.SHARE_ENV');

exports.backend = backend.polyfill ? 'polyfill' : 'web_workers';
exports.browser = true;
exports.base = source.base();
exports.require = source.require;
exports.resolve = source.resolve;

function exit(code) {
  throw new Error(`Main thread exited: ${code}.`);
}

exports.exit = typeof process.exit === 'function'
  ? process.exit.bind(process)
  : exit;

exports.stdin = process.stdin || new stream.Readable();
exports.stdout = process.stdout || new stdio.Console(console.log, console);
exports.stderr = process.stderr || new stdio.Console(console.error, console);
exports.console = new Console(exports.stdout, exports.stderr);

socket.inject(exports);
