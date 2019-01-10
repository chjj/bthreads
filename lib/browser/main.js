'use strict';

const socket = require('../internal/socket');
const {MessagePortBase, MessageChannel} = require('./common');
const Worker = require('./worker');

exports.isMainThread = true;
exports.parentPort = null;
exports.threadId = 0;
exports.MessagePort = MessagePortBase;
exports.MessageChannel = MessageChannel;
exports.Worker = Worker;
exports.browser = true;

socket.inject(exports);
