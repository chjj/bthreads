/*!
 * main.js - main thread entry point for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 */

'use strict';

const socket = require('../internal/socket');
const {getter} = require('../internal/utils');
const {MessagePortBase, MessageChannel} = require('./common');
const Worker = require('./worker');

exports.isMainThread = true;
exports.parentPort = null;
exports.threadId = 0;
exports.workerData = null;
exports.MessagePort = MessagePortBase;
exports.MessageChannel = MessageChannel;
exports.Worker = Worker;
exports.moveMessagePortToContext = null;
exports.SHARE_ENV = Symbol.for('nodejs.worker_threads.SHARE_ENV');
exports.importScripts = null;

exports.backend = 'child_process';
exports.browser = false;
exports.source = require.main ? require.main.filename : null;

exports.exit = process.exit.bind(process);

getter(exports, 'stdin', () => process.stdin);
getter(exports, 'stdout', () => process.stdout);
getter(exports, 'stderr', () => process.stderr);
getter(exports, 'console', () => console);

socket.inject(exports);
