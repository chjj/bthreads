'use strict';

const assert = require('assert');
const {isMainThread, parentPort, workerData} = require('bthreads');

assert(!isMainThread);

parentPort.postMessage(Buffer.from(workerData + 'bar'));
