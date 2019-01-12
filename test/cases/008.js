'use strict';

const assert = require('assert');
const {isMainThread, parentPort} = require('bthreads');

assert(!isMainThread);

// NOTE: worker_threads hangs even if we're not listening on stdin.
process.stdin.setEncoding('utf8');
process.stdin.on('data', (data) => {
  parentPort.postMessage(data.trim() + 'bar');
});
