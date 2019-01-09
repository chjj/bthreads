'use strict';

const {parentPort, workerData} = require('../../');

parentPort.postMessage({ msg: 'hello world', workerData });
