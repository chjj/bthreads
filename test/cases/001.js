'use strict';

const assert = require('assert');
const threads = require('../../');

assert(!threads.isMainThread);

threads.parentPort.postMessage(Buffer.from(threads.workerData + 'bar'));
