'use strict';

const assert = require('assert');
const threads = require('../../');

assert(!threads.isMainThread);

// NOTE: worker_threads hangs even if we're not listening on stdin.
process.stdin.setEncoding('utf8');
process.stdin.on('data', (data) => {
  threads.parentPort.postMessage(data.trim() + 'bar');
});
