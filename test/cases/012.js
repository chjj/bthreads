'use strict';

const assert = require('assert');
const {join} = require('path');
const threads = require('../../');

assert(!threads.isMainThread);

const {port1, port2} = new threads.MessageChannel();

threads.parentPort.postMessage(port2, [port2]);

const worker = new threads.Worker(join(__dirname, '013.js'));

worker.postMessage(port1, [port1]);

worker.on('exit', (code) => {
  assert(code === 0);
  process.exit(0);
});
