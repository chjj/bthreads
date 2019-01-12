'use strict';

const assert = require('assert');
const {join} = require('path');
const {Worker, isMainThread, parentPort, MessageChannel} = require('bthreads');

assert(!isMainThread);

const {port1, port2} = new MessageChannel();

parentPort.postMessage(port2, [port2]);

const worker = new Worker(join(__dirname, '013.js'));

worker.postMessage(port1, [port1]);

worker.on('exit', (code) => {
  assert(code === 0);
  process.exit(0);
});
