'use strict';

const {MessagePort, MessageChannel} = require('./common');
const Parent = require('./parent');
const parent = new Parent();

exports.isMainThread = false;
exports.parentPort = parent;
exports.threadId = parent._threadId;
exports.workerData = parent._workerData;
exports.MessagePort = MessagePort;
exports.MessageChannel = MessageChannel;
exports.Worker = null;
