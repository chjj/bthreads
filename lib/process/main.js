/*!
 * main.js - main thread entry point for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 */

'use strict';

const socket = require('../internal/socket');
const {MessagePortBase, MessageChannel} = require('./common');
const Worker = require('./worker');

exports.isMainThread = true;
exports.parentPort = null;
exports.threadId = 0;
exports.workerData = null;
exports.MessagePort = MessagePortBase;
exports.MessageChannel = MessageChannel;
exports.Worker = Worker;
exports.importScripts = null;

exports.backend = 'child_process';
exports.browser = false;
exports.source = require.main ? require.main.filename : null;
exports.process = exports;

exports.exit = process.exit.bind(process);
exports.stdin = process.stdin;
exports.stdout = process.stdout;
exports.stderr = process.stderr;
exports.console = console;

socket.inject(exports);
