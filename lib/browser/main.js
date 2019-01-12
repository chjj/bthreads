'use strict';

const socket = require('../internal/socket');
const backend = require('./backend');
const {MessagePortBase, MessageChannel} = require('./common');
const Worker = require('./worker');

exports.isMainThread = true;
exports.parentPort = null;
exports.threadId = 0;
exports.MessagePort = MessagePortBase;
exports.MessageChannel = MessageChannel;
exports.Worker = Worker;

exports.backend = backend.polyfill ? 'polyfill' : 'web_workers';
exports.browser = true;

// import.meta would be very useful here :(
exports.source = (() => {
  if (!global.document)
    return null;

  if (!global.document.currentScript)
    return null;

  if (typeof global.document.currentScript.src !== 'string')
    return null;

  return global.document.currentScript.src || null;
});

exports.process = exports;

socket.inject(exports);
