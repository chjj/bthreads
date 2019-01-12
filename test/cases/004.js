'use strict';

const assert = require('assert');
const {isMainThread, workerData} = require('bthreads');

assert(!isMainThread);

process.stderr.write(workerData + 'bar');
