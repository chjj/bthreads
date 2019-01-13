'use strict';

const assert = require('assert');
const threads = require('../../');

assert(!threads.isMainThread);

const {port1, port2} = new threads.MessageChannel();

threads.parentPort.postMessage(port2, [port2]);

port1.on('message', (msg) => {
  assert.strictEqual(msg, 'hello world');
  process.exit(0);
});
