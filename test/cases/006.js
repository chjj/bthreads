'use strict';

const assert = require('assert');
const {isMainThread, workerData} = require('bthreads');

assert(!isMainThread);

console.error(workerData + 'bar');
