'use strict';

const {MessagePort, MessageChannel} = require('./common');
const Parent = require('./parent');
const parent = new Parent();

exports.isMainThread = false;
exports.parentPort = parent;
exports.threadId = parent.threadId;
exports.workerData = parent.workerData;
exports.MessagePort = MessagePort;
exports.MessageChannel = MessageChannel;
exports.Worker = null;
