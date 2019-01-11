'use strict';

const socket = require('../internal/socket');
const {MessagePortBase, MessageChannel} = require('./common');
const importScripts = require('./import');
const Parent = require('./parent');
const Worker = require('./worker');
const parent = new Parent();

exports.isMainThread = false;
exports.parentPort = parent;
exports.threadId = parent._threadId;
exports.workerData = parent._workerData;
exports.MessagePort = MessagePortBase;
exports.MessageChannel = MessageChannel;
exports.Worker = Worker;
exports.importScripts = importScripts;

exports.backend = 'web_workers';
exports.browser = true;
exports.process = exports;

socket.inject(exports);
