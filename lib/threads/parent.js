'use strict';

const threads = require('worker_threads');
const {MessagePort} = require('./common');
const walk = require('../internal/walk');

/**
 * Parent
 */

class Parent extends MessagePort {
  constructor() {
    super(threads.parentPort);
    this.threadId = threads.threadId;
    this.workerData = walk.unmorph(threads.workerData);
  }
}

/*
 * Expose
 */

module.exports = Parent;
