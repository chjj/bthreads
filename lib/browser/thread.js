'use strict';

const socket = require('../internal/socket');
const {MessagePortBase, MessageChannel} = require('./common');
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
exports.browser = true;

socket.inject(exports);
