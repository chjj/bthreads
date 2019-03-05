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
          this.target.addListener(name, handler);
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
          this.target.removeListener(name, handler);
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
 * Expose
 */

module.exports = EventProxy;
