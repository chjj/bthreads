/*!
 * thread.js - child thread entry point for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 */

'use strict';

const socket = require('../internal/socket');
const backend = require('./backend');
const common = require('./common');
const Parent = require('./parent');
const source = require('./source');
const Worker = require('./worker');
const {MessagePortBase, MessageChannel} = common;
const parent = new Parent();

exports.isMainThread = false;
exports.parentPort = parent;
exports.threadId = parent._workerId;
exports.workerData = parent._workerData;
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

exports.exit = parent._exit;
exports.stdin = parent._stdin;
exports.stdout = parent._stdout;
exports.stderr = parent._stderr;
exports.console = parent._console;

socket.inject(exports);

global.bthreads = exports;
