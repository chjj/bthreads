/*!
 * main.js - main thread entry point for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 */

'use strict';

const socket = require('../internal/socket');
const backend = require('./backend');
const common = require('./common');
const source = require('./source');
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
exports.baseURL = source.baseURL();
exports.filename = source.filename();
exports.dirname = source.dirname();
exports.require = source.require;
exports.resolve = source.resolve;

function exit(code) {
  throw new Error(`Main thread exited: ${code}.`);
}

exports.exit = typeof process.exit === 'function'
  ? process.exit.bind(process)
  : exit;

exports.stdin = process.stdin;
exports.stdout = process.stdout;
exports.stderr = process.stderr;
exports.console = console;

socket.inject(exports, source, null);
