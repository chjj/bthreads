'use strict';

const Worker = require('./worker');

exports.isMainThread = true;
exports.parentPort = null;
exports.threadId = 0;
exports.MessagePort = null;
exports.MessageChannel = null;
exports.Worker = Worker;
