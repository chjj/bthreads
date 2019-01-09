'use strict';

const Parent = require('./parent');
const parent = new Parent();

exports.isMainThread = false;
exports.parentPort = parent;
exports.threadId = parent.threadId;
exports.workerData = parent.workerData;
exports.MessagePort = null;
exports.MessageChannel = null;
exports.Worker = null;
