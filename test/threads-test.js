/* eslint-env mocha */
/* global register, BigInt */

'use strict';

Buffer.poolSize = 1;

const assert = require('assert');
const {join} = require('path');
const encoding = require('../lib/internal/encoding');
const threads = require('../');
const location = global.location || {};
const parts = process.version.split(/[^\d]/);
const version = (0
  + (parts[1] & 0xff) * 0x10000
  + (parts[2] & 0xff) * 0x00100
  + (parts[3] & 0xff) * 0x00001);

const PORT = (location.port >>> 0) || 80;
const URL = `http://localhost:${PORT}/bundle.js`;

const vector = (index) => {
  let n = index.toString(10);

  while (n.length < 3)
    n = '0' + n;

  return join(__dirname, 'cases', `${n}.js`);
};

function onExit(cb, test, expect) {
  if (typeof test === 'number')
    [test, expect] = [expect, test];

  return (code) => {
    if ((code >>> 0) !== (expect >>> 0))
      cb(new Error('Exit code: ' + code));
    else if (test && !test())
      cb(new Error('Condition not met.'));
    else
      cb();
  };
}

function wait(thread, test, expect) {
  return new Promise((resolve, reject) => {
    const cb = (err) => {
      if (err)
        reject(err);
      else
        resolve();
    };

    thread.on('error', reject);
    thread.on('exit', onExit(cb, test, expect));
  });
}

if (process.browser) {
  register('/bundle.js', [__dirname, '../lib/browser/bundle.js']);
  // 012.js calls 013.js. Must be registered here.
  register('/test/cases/013.js', [__dirname, './cases/013.js']);
}

describe(`Threads (${threads.backend})`, (ctx) => {
  ctx.timeout(5000);

  it('should encode and decode', () => {
    const arr = new Float32Array([1, 2]);
    const enc = encoding.encode(arr);
    const dec = encoding.decode(enc);

    assert.deepStrictEqual(dec, arr);
  });

  it('should have correct environment', () => {
    const argv = process.execArgv || [];
    const experimental = argv.includes('--experimental-worker');
    const backend = process.env.BTHREADS_BACKEND;
    const native = !backend
      || backend === 'web_workers'
      || backend === 'worker_threads';

    assert(threads.isMainThread);

    if (process.browser) {
      if (native && global.Worker)
        assert.strictEqual(threads.backend, 'web_workers');
      else
        assert.strictEqual(threads.backend, 'polyfill');
    } else {
      if (native && (version >= 0x0b0700 || experimental))
        assert.strictEqual(threads.backend, 'worker_threads');
      else
        assert.strictEqual(threads.backend, 'child_process');
    }

    if (process.browser)
      assert(threads.browser);

    assert(typeof threads.source === 'string');
    assert(threads.process);
  });

  it('should create message channel', (cb) => {
    const {port1, port2} = new threads.MessageChannel();

    port2.on('message', (msg) => {
      assert.deepStrictEqual(msg, { foo: 1 });
      port1.close();
      port2.close();
      cb();
    });

    port1.postMessage({ foo: 1 });
  });

  it('should create worker with data', (cb) => {
    const worker = new threads.Worker(vector(1), {
      workerData: 'foo'
    });

    let called = false;

    worker.on('message', (msg) => {
      msg = Buffer.from(msg);
      assert.strictEqual(msg.toString(), 'foobar');
      called = true;
      if (threads.browser)
        worker._terminate(0);
    });

    worker.on('error', cb);
    worker.on('exit', onExit(cb, () => called));
  });

  it('should have stdin', (cb) => {
    const worker = new threads.Worker(vector(2), {
      stdin: true
    });

    let called = false;

    worker.on('message', (msg) => {
      assert.strictEqual(msg, 'foobar');
      called = true;
    });

    worker.on('error', cb);
    worker.on('exit', onExit(cb, () => called));

    worker.stdin.write('foo\n');
  });

  it('should not hang if there is no input', (cb) => {
    if (threads.browser)
      cb.skip();

    const worker = new threads.Worker(vector(2), {
      stdin: true
    });

    let called = false;

    worker.on('message', (msg) => {
      called = true;
    });

    worker.on('error', cb);
    worker.on('exit', onExit(cb, () => !called));
  });

  it('should have stdout', (cb) => {
    const worker = new threads.Worker(vector(3), {
      workerData: 'foo',
      stdout: true
    });

    let called = false;

    worker.stdout.setEncoding('utf8');
    worker.stdout.on('data', (msg) => {
      assert.strictEqual(msg, 'foobar');
      called = true;
      if (threads.browser)
        worker._terminate(0);
    });

    worker.on('error', cb);
    worker.on('exit', onExit(cb, () => called));
  });

  it('should have stderr', (cb) => {
    const worker = new threads.Worker(vector(4), {
      workerData: 'foo',
      stderr: true
    });

    let called = false;

    worker.stderr.setEncoding('utf8');
    worker.stderr.on('data', (msg) => {
      assert.strictEqual(msg, 'foobar');
      called = true;
      if (threads.browser)
        worker._terminate(0);
    });

    worker.on('error', cb);
    worker.on('exit', onExit(cb, () => called));
  });

  it('should have console.log', (cb) => {
    const worker = new threads.Worker(vector(5), {
      workerData: 'foo',
      stdout: true
    });

    let called = false;

    worker.stdout.setEncoding('utf8');
    worker.stdout.on('data', (msg) => {
      assert.strictEqual(msg, 'foobar\n');
      called = true;
      if (threads.browser)
        worker._terminate(0);
    });

    worker.on('error', cb);
    worker.on('exit', onExit(cb, () => called));
  });

  it('should have console.error', (cb) => {
    const worker = new threads.Worker(vector(6), {
      workerData: 'foo',
      stderr: true
    });

    let called = false;

    worker.stderr.setEncoding('utf8');
    worker.stderr.on('data', (msg) => {
      assert.strictEqual(msg, 'foobar\n');
      called = true;
      if (threads.browser)
        worker._terminate(0);
    });

    worker.on('error', cb);
    worker.on('exit', onExit(cb, () => called));
  });

  it('should terminate long running thread', (cb) => {
    const worker = new threads.Worker(vector(7));

    let called = false;

    worker.on('message', (msg) => {
      assert.strictEqual(msg, 'kill me');
      called = true;
      worker.terminate();
    });

    worker.on('error', cb);
    worker.on('exit', onExit(cb, () => called, 1));
  });

  it('should hang on input', (cb) => {
    const worker = new threads.Worker(vector(8), {
      stdin: true
    });

    let called = false;

    worker.on('error', cb);

    worker.on('exit', () => {
      called = true;
    });

    // NOTE: worker_threads hangs even if we're not listening on stdin.
    setTimeout(() => {
      assert(!called);
      worker.terminate();
      cb();
    }, 1000);
  });

  it('should open message port with child', (cb) => {
    const worker = new threads.Worker(vector(9));
    const {port1, port2} = new threads.MessageChannel();

    worker.postMessage(port2, [port2]);

    let called = false;

    port1.on('message', (msg) => {
      assert.strictEqual(msg, 'hello world');
      called = true;
    });

    worker.on('error', cb);
    worker.on('exit', onExit(cb, () => called));
  });

  it('should open message port with parent', (cb) => {
    const worker = new threads.Worker(vector(10));

    let called = false;

    worker.on('message', (port) => {
      assert(port instanceof threads.MessagePort);
      port.postMessage('hello world');
      called = true;
    });

    worker.on('error', cb);
    worker.on('exit', onExit(cb, () => called));
  });

  it('should open port between children', (cb) => {
    const worker1 = new threads.Worker(vector(11));
    const worker2 = new threads.Worker(vector(11));
    const {port1, port2} = new threads.MessageChannel();

    worker1.on('error', cb);
    worker2.on('error', cb);

    let i = 2;

    function done(err) {
      if (err)
        cb(err);
      else if (--i === 0)
        cb();
    }

    worker1.on('exit', onExit(done));
    worker2.on('exit', onExit(done));

    worker1.postMessage(port1, [port1]);
    worker2.postMessage(port2, [port2]);
  });

  it('should receive and send port', (cb) => {
    const worker1 = new threads.Worker(vector(10));
    const worker2 = new threads.Worker(vector(9));

    let called = false;

    worker1.on('error', cb);
    worker2.on('error', cb);

    worker1.on('message', (port) => {
      assert(port instanceof threads.MessagePort);
      worker2.postMessage(port, [port]);
      called = true;
    });

    let i = 2;

    function done(err) {
      if (err)
        cb(err);
      else if (--i === 0)
        cb();
    }

    worker1.on('exit', onExit(done, () => called));
    worker2.on('exit', onExit(done, () => called));
  });

  it('should create nested worker to talk to', (cb) => {
    // NOTE: This was failing _silently_ earlier when
    // 012.js couldn't find 013.js (because it wasn't
    // registered). Investigate. Add errors tests.
    const worker = new threads.Worker(vector(12));

    let called = false;

    worker.on('message', (port) => {
      assert(port instanceof threads.MessagePort);
      port.on('message', (msg) => {
        assert.strictEqual(msg, 'hello from below');
        called = true;
      });
    });

    worker.on('error', cb);
    worker.on('exit', onExit(cb, () => called));
  });

  it('should transfer buffer', (cb) => {
    const worker = new threads.Worker(vector(14));

    let called = false;

    worker.on('error', cb);

    worker.on('message', (msg) => {
      msg = Buffer.from(msg);
      assert.strictEqual(msg.toString(), 'foobar');
      called = true;
    });

    const data = Buffer.from('foobar');

    worker.postMessage(data, [data.buffer]);

    if (threads.backend === 'web_workers'
        || threads.backend === 'worker_threads') {
      assert(data.length === 0);
    }

    worker.on('exit', onExit(cb, () => called));
  });

  it('should eval string', (cb) => {
    function workerThread() {
      const assert = global.require('assert');
      const path = global.require('path');
      const threads = global.require('bthreads');

      assert(threads.parentPort);
      assert(!global.require.main);
      assert.strictEqual(module.id, '[worker eval]');
      assert.strictEqual(path.basename(module.filename), '[worker eval]');
      assert.strictEqual(__dirname, '.');
      assert.strictEqual(__filename, '[worker eval]');
      assert(!threads.source);

      threads.parentPort.postMessage('evaled!');

      setTimeout(() => {
        process.exit(2);
      }, 100);
    }

    const code = `(${workerThread}).call(this);`;
    const worker = new threads.Worker(code, {
      header: URL,
      eval: true
    });

    let called = false;

    worker.on('error', cb);

    worker.on('message', (msg) => {
      assert.strictEqual(msg, 'evaled!');
      called = true;
    });

    worker.on('exit', onExit(cb, () => called, 2));
  });

  it('should do basic thread test', async () => {
    const thread = new threads.Thread(vector(15));

    let called = false;

    thread.bind('event', (x, y) => {
      assert.strictEqual(x + y, 'foobar');
      called = true;
    });

    const buf1 = await thread.call('job', ['hello']);
    const buf2 = await thread.call('job', ['goodbye']);

    assert.strictEqual(buf1.toString(), 'hello world');
    assert.strictEqual(buf2.toString(), 'goodbye world');

    setTimeout(() => {
      thread.terminate();
    }, 1000);

    return wait(thread, () => called, 1);
  });

  it('should test pool (serial)', async () => {
    const pool = new threads.Pool(vector(15));

    let called = false;

    pool.bind('event', (x, y) => {
      assert.strictEqual(x + y, 'foobar');
      called = true;
    });

    for (let i = 0; i < 10; i++) {
      const data = await pool.call('job', [i]);
      assert.strictEqual(data.toString(), i + ' world');
    }

    await pool.close();

    assert(called);
  });

  it('should test pool (parallel)', async () => {
    const pool = new threads.Pool(vector(15));

    let called = false;

    pool.bind('event', (x, y) => {
      assert.strictEqual(x + y, 'foobar');
      called = true;
    });

    const jobs = [];

    for (let i = 0; i < 10; i++)
      jobs.push(pool.call('job', [i]));

    const results = await Promise.all(jobs);

    for (let i = 0; i < 10; i++)
      assert.strictEqual(results[i].toString(), i + ' world');

    await pool.close();

    assert(called);
  });

  it('should transfer buffer to thread', async () => {
    const thread = new threads.Thread(() => {
      const assert = global.require('assert');
      const {parent} = global.require('bthreads');

      parent.hook('job', (data) => {
        assert(Buffer.isBuffer(data));
        setTimeout(() => process.exit(0), 100);
        return [data, [data.buffer]];
      });
    }, { header: URL });

    const data = Buffer.from('foo');
    const result = await thread.call('job', [data], [data.buffer]);

    if (threads.backend === 'web_workers'
        || threads.backend === 'worker_threads') {
      assert(data.length === 0);
    }

    assert(Buffer.isBuffer(result));
    assert(result.length === 3);

    return wait(thread, 0);
  });

  it('should transfer complex data to thread', async () => {
    const thread = new threads.Thread(() => {
      const {parent} = global.require('bthreads');

      parent.hook('job', (data) => {
        setTimeout(() => process.exit(0), 100);
        return data;
      });
    }, { header: URL });

    const date = new Date();
    const data = {
      undefined_: undefined,
      null_: null,
      true_: true,
      false_: false,
      number: date.getTime(),
      nan: NaN,
      infinity: Infinity,
      ninfinity: -Infinity,
      nzero: -0,
      int8: -1,
      uint8: 1,
      string: 'foobar',
      bigint: typeof BigInt === 'function' ? BigInt(-100) : undefined,
      object: { foo: 'bar' },
      array: [1, 2],
      map: new Map([[1, 2]]),
      set: new Set([1, 2]),
      regex: /foobar/,
      date: date,
      invalidDate: new Date('foo'),
      arrayBuffer: Buffer.from('foobar').buffer,
      buffer: Buffer.from('foobar'),
      int8Array: new Int8Array([-1, -2]),
      uint8Array: new Uint8Array([1, 2]),
      int16Array: new Int16Array([-1, -2]),
      uint16Array: new Uint16Array([1, 2]),
      int32Array: new Int32Array([-1, -2]),
      uint32Array: new Uint32Array([1, 2]),
      floatArray: new Float32Array([1, 2]),
      doubleArray: new Float64Array([1, 2]),
      reference: undefined,
      circular: undefined
    };

    data.reference = data.object;
    data.circular = data;

    const result = await thread.call('job', [data]);

    assert(result && typeof result === 'object');
    assert(result.__proto__ === Object.prototype);
    assert(result !== data);

    if (threads.browser || version < 0x0a0000) {
      assert.strictEqual(result.undefined_, undefined);
      assert.strictEqual(result.null_, null);
      assert.strictEqual(result.true_, true);
      assert.strictEqual(result.false_, false);
      assert.strictEqual(result.number, date.getTime());
      assert.strictEqual(result.nan !== result.nan, true);
      assert.strictEqual(result.infinity, Infinity);
      assert.strictEqual(result.ninfinity, -Infinity);
      assert.strictEqual(result.nzero, -0);
      assert.strictEqual(result.int8, -1);
      assert.strictEqual(result.uint8, 1);
      assert.strictEqual(result.string, 'foobar');
      if (typeof BigInt === 'function')
        assert.strictEqual(result.bigint, BigInt(-100));
      assert.strictEqual(result.object.__proto__, Object.prototype);
      assert.strictEqual(result.object.foo, 'bar');
      assert.strictEqual(result.array.length, 2);
      assert.strictEqual(result.array[0], 1);
      assert.strictEqual(result.array[1], 2);
      assert.strictEqual(result.map.size, 1);
      assert.strictEqual(result.map.get(1), 2);
      assert.strictEqual(result.set.size, 2);
      assert.strictEqual(result.set.has(1), true);
      assert.strictEqual(result.set.has(2), true);
      assert.strictEqual(result.regex.source, 'foobar');
      assert.strictEqual(result.date.getTime(), date.getTime());
      assert.strictEqual(result.invalidDate.toString(), 'Invalid Date');
      assert.strictEqual(Buffer.from(result.arrayBuffer).toString('utf8'),
                         'foobar');
      assert.strictEqual(result.buffer.toString('utf8'), 'foobar');
      assert.strictEqual(result.int8Array.length, 2);
      assert.strictEqual(result.int8Array[0], -1);
      assert.strictEqual(result.int8Array[1], -2);
      assert.strictEqual(result.uint8Array.length, 2);
      assert.strictEqual(result.uint8Array[0], 1);
      assert.strictEqual(result.uint8Array[1], 2);
      assert.strictEqual(result.int16Array.length, 2);
      assert.strictEqual(result.int16Array[0], -1);
      assert.strictEqual(result.int16Array[1], -2);
      assert.strictEqual(result.uint16Array.length, 2);
      assert.strictEqual(result.uint16Array[0], 1);
      assert.strictEqual(result.uint16Array[1], 2);
      assert.strictEqual(result.int32Array.length, 2);
      assert.strictEqual(result.int32Array[0], -1);
      assert.strictEqual(result.int32Array[1], -2);
      assert.strictEqual(result.uint32Array.length, 2);
      assert.strictEqual(result.uint32Array[0], 1);
      assert.strictEqual(result.uint32Array[1], 2);
      assert.strictEqual(result.floatArray.length, 2);
      assert.strictEqual(result.floatArray[0], 1);
      assert.strictEqual(result.floatArray[1], 2);
      assert.strictEqual(result.doubleArray.length, 2);
      assert.strictEqual(result.doubleArray[0], 1);
      assert.strictEqual(result.doubleArray[1], 2);
      assert.strictEqual(result.reference, result.object);
      assert.strictEqual(result.circular, result);
    } else {
      data.invalidDate = result.invalidDate;
      data.uint8Array = Buffer.from([1, 2]);

      assert.strictEqual(result.object.__proto__, Object.prototype);
      assert.strictEqual(result.reference, result.object);
      assert.strictEqual(result.circular, result);
      assert.strictEqual(result.invalidDate.toString(), 'Invalid Date');

      assert.deepStrictEqual(result, data);
    }

    return wait(thread, 0);
  });

  it('should import scripts', async (x) => {
    if (threads.backend !== 'web_workers')
      x.skip();

    const thread = new threads.Thread(() => {
      const assert = global.require('assert');
      const threads = global.require('bthreads');

      const _ = threads.importScripts(
        'https://unpkg.com/underscore@1.9.1/underscore.js');

      assert.strictEqual(_.VERSION, '1.9.1');

      console.log(_.VERSION);

      process.exit(0);
    }, { header: URL, stdout: true });

    let called = false;

    // Test stdout while we're at it.
    thread.stdout.setEncoding('utf8');
    thread.stdout.on('data', (data) => {
      assert.strictEqual(data.trim(), '1.9.1');
      called = true;
    });

    return wait(thread, () => called, 0);
  });

  it('should send port to thread', async () => {
    const thread = new threads.Thread(() => {
      const {parent} = global.require('bthreads');

      parent.hook('port', (port) => {
        port.hook('job', () => {
          return 'hello';
        });
      });
    }, { header: URL });

    const {port1, port2} = new threads.Channel();

    await thread.call('port', [port1], [port1]);

    assert.strictEqual(await port2.call('job'), 'hello');

    await port2.close();
    await thread.close();
  });

  it('should send port to nested thread', async () => {
    // Double-evaled nested workers with ports
    // sent down two layers. How cool is that?
    const thread = new threads.Thread(() => {
      const threads = global.require('bthreads');
      const {parent} = threads;

      let thread;

      parent.hook('spawn', () => {
        thread = new threads.Thread(() => {
          const {parent} = global.require('bthreads');

          parent.hook('port', (port) => {
            port.hook('job', () => {
              return 'hello';
            });
          });
        });
      });

      parent.hook('port', async (port) => {
        await thread.call('port', [port], [port]);
      });

      parent.hook('close', async () => {
        await thread.close();
      });
    }, { header: URL });

    const {port1, port2} = new threads.Channel();

    await thread.call('spawn');
    await thread.call('port', [port1], [port1]);

    assert.strictEqual(await port2.call('job'), 'hello');

    await thread.call('close');

    await port2.close();
    await thread.close();
  });

  it('should close child', (cb) => {
    if (threads.browser)
      cb.skip();

    const worker = new threads.Worker(vector(16));

    worker.on('error', cb);
    worker.on('exit', onExit(cb));
  });

  it('should bind console without require', (cb) => {
    if (threads.browser)
      cb.skip();

    const worker = new threads.Worker(vector(17), {
      stdout: true
    });

    let called = false;

    worker.stdout.setEncoding('utf8');
    worker.stdout.on('data', (msg) => {
      assert.strictEqual(msg, 'foobar\n');
      called = true;
      if (threads.browser)
        worker._terminate(0);
    });

    worker.on('error', cb);
    worker.on('exit', onExit(cb, () => called));
  });

  it('should propagate stdout through multiple layers', (cb) => {
    if (threads.browser)
      cb.skip();

    const thread = new threads.Thread(() => {
      const threads = global.require('bthreads');

      new threads.Thread(() => {
        const threads = global.require('bthreads');

        new threads.Thread(() => {
          const threads = global.require('bthreads');

          new threads.Thread(() => {
            console.log('foobar');
          });
        });
      });
    }, { stdout: true });

    let called = false;

    thread.on('error', cb);
    thread.on('exit', onExit(cb, () => called));

    thread.stdout.on('data', (data) => {
      assert.strictEqual(data.toString('utf8'), 'foobar\n');
      called = true;
    });
  });

  it('should throw error', async () => {
    const thread = new threads.Thread(() => {
      const threads = global.require('bthreads');

      threads.parent.hook('job', () => {
        throw new Error('foobar');
      });
    }, { header: URL });

    if (!assert.rejects) {
      try {
        await thread.call('job');
      } catch (e) {
        assert(/foobar/.test(e.message));
      }
    } else {
      await assert.rejects(thread.call('job'), /foobar/);
    }

    await thread.close();
  });

  it('should propagate exception', (cb) => {
    if (threads.backend === 'polyfill')
      cb.skip();

    const thread = new threads.Thread(() => {
      setImmediate(() => {
        throw new Error('foobar');
      });
    }, { header: URL });

    let called = false;

    thread.on('error', (err) => {
      assert(!called);
      assert.strictEqual(err.message, 'foobar');
      called = true;
    });

    thread.on('exit', onExit(cb, () => called, 1));
  });

  it('should propagate rejection', (cb) => {
    if (threads.backend === 'polyfill')
      cb.skip();

    const thread = new threads.Thread(() => {
      // Need this for `worker_threads` backend.
      global.require('bthreads');

      setImmediate(() => {
        new Promise((resolve, reject) => {
          reject(new Error('foobar'));
        });
      });
    }, { header: URL });

    let called = false;

    thread.on('error', (err) => {
      assert(!called);
      assert.strictEqual(err.message, 'foobar');
      called = true;
    });

    thread.on('exit', onExit(cb, () => called, 1));
  });
});
