'use strict';

const {MessagePort, MessageChannel} = require('./common');
const Worker = require('./worker');

exports.isMainThread = true;
exports.parentPort = null;
exports.threadId = 0;
exports.MessagePort = MessagePort;
exports.MessageChannel = MessageChannel;
exports.Worker = Worker;
exports.browser = true;
