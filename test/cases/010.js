'use strict';

const assert = require('assert');
const {isMainThread, parentPort, MessageChannel} = require('bthreads');

assert(!isMainThread);

const {port1, port2} = new MessageChannel();

parentPort.postMessage(port2, [port2]);

port1.on('message', (msg) => {
  assert.strictEqual(msg, 'hello world');
  process.exit(0);
});
