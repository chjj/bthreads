/*!
 * thread.js - child thread entry point for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 */

'use strict';

const socket = require('../internal/socket');
const source = require('../internal/source');
const {getter} = require('../internal/utils');
const {MessagePortBase, MessageChannel} = require('./common');
const Worker = require('./worker');
const Parent = require('./parent');
const parent = new Parent();
const limits = parent._workerLimits;

exports.isMainThread = false;
exports.parentPort = parent;
exports.threadId = parent._workerId;
exports.workerData = parent._workerData;
exports.resourceLimits = {
  maxYoungGenerationSizeMb: limits[0] === -1 ? 48 : limits[0],
  maxOldGenerationSizeMb: limits[1] === -1 ? 2048 : limits[1],
  codeRangeSizeMb: limits[2] === -1 ? 0 : limits[2]
};
exports.MessagePort = MessagePortBase;
exports.MessageChannel = MessageChannel;
exports.Worker = Worker;
exports.moveMessagePortToContext = null;
exports.receiveMessageOnPort = null;
exports.SHARE_ENV = Symbol.for('nodejs.worker_threads.SHARE_ENV');

exports.backend = 'child_process';
exports.browser = false;
getter(exports, 'location', () => source.location(__filename));
getter(exports, 'filename', () => source.filename(__filename));
getter(exports, 'dirname', () => source.dirname(__filename));
exports.require = req => source.require(req, __filename);
exports.resolve = req => source.resolve(req, __filename);
exports.exit = parent._exit;

socket.inject(exports, source, Buffer, null);
