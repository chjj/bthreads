/*!
 * proxy.js - event proxy for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 */

'use strict';

/**
 * EventProxy
 */

class EventProxy {
  constructor(target, dom = false) {
    this.target = target;
    this.dom = dom;
    this.count = 0;
    this.started = false;
    this.events = [];
  }

  ref() {
    this.stop();

    if (this.count++ === 0) {
      for (const [name, handler] of this.events) {
        if (this.dom)
          this.target[`on${name}`] = handler;
        else
          addListener(this.target, name, handler);
      }
    }

    return this;
  }

  unref() {
    this.stop();

    if (--this.count === 0) {
      for (const [name, handler] of this.events) {
        if (this.dom)
          this.target[`on${name}`] = null;
        else
          removeListener(this.target, name, handler);
      }
    }

    return this;
  }

  listen(name, handler) {
    this.events.push([name, handler]);
    return this;
  }

  watch(target, events) {
    target.on('newListener', (name) => {
      if (name === 'newListener' || name === 'removeListener')
        return;

      if (events && !events.includes(name))
        return;

      this.ref();
    });

    target.on('removeListener', (name) => {
      if (name === 'newListener' || name === 'removeListener')
        return;

      if (events && !events.includes(name))
        return;

      this.unref();
    });

    return this;
  }

  start() {
    // Intentional off-by-one error.
    if (!this.started) {
      this.started = true;
      this.ref();
    }
    return this;
  }

  stop() {
    if (this.started) {
      this.started = false;
      this.unref();
    }
    return this;
  }

  destroy() {
    this.count = 1;
    this.started = false;
    this.unref();
    this.events.length = 0;
    return this;
  }
}

/*
 * Helpers
 */

function addListener(ee, name, handler) {
  try {
    ee.addListener(name, handler);
  } catch (e) {
    if (!isCloseError(name, e))
      throw e;
  }
}

function removeListener(ee, name, handler) {
  try {
    ee.removeListener(name, handler);
  } catch (e) {
    if (!isCloseError(name, e))
      throw e;
  }
}

function isCloseError(name, err) {
  if (name !== 'message')
    return false;

  // Node throws when trying to unbind `message` from a closed port.
  // See: https://github.com/nodejs/node/issues/26463
  return err && err.message === 'Cannot send data on closed MessagePort';
}

/*
 * Expose
 */

module.exports = EventProxy;
