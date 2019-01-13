/*!
 * thread.js - child thread entry point for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 */

'use strict';

const socket = require('../internal/socket');
const backend = require('./backend');
const common = require('./common');
const importScripts = require('./import');
const Parent = require('./parent');
const Worker = require('./worker');
const {MessagePortBase, MessageChannel} = common;
const location = String(backend.location);
const parent = new Parent();
const isEval = parent._workerEval;

exports.isMainThread = false;
exports.parentPort = parent;
exports.threadId = parent._threadId;
exports.workerData = parent._workerData;
exports.MessagePort = MessagePortBase;
exports.MessageChannel = MessageChannel;
exports.Worker = Worker;
exports.importScripts = importScripts;

exports.backend = backend.polyfill ? 'polyfill' : 'web_workers';
exports.browser = true;
exports.source = isEval ? null : location;
exports.process = exports;

socket.inject(exports);
