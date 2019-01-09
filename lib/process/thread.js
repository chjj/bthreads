'use strict';

const listeners = process.listeners('warning');

process.removeAllListeners('warning');

const {MessagePort, MessageChannel} = require('./common');
const Worker = require('./worker');
const Parent = require('./parent');
const parent = new Parent();

exports.isMainThread = false;
exports.parentPort = parent;
exports.threadId = parent._threadId;
exports.workerData = parent._workerData;
exports.MessagePort = MessagePort;
exports.MessageChannel = MessageChannel;
exports.Worker = Worker;

for (const listener of listeners)
  process.on('warning', listener);
