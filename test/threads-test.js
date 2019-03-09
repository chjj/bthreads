/* eslint-env mocha */
/* global register, BigInt, Blob, FileReader */

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

const PROTO = location.protocol || 'http:';
const PORT = (location.port >>> 0) || 80;
const URL = `${PROTO}//localhost:${PORT}/eval.js`;

const vector = (index) => {
  let n = index.toString(10);

  while (n.length < 3)
    n = '0' + n;

  return join(__dirname, 'cases', `${n}.js`);
};

async function readBlob(blob) {
  const reader = new FileReader();
  reader.readAsText(blob);
  return new Promise((resolve, reject) => {
    reader.onerror = reject;
    reader.onloadend = () => {
      resolve(reader.result);
    };
  });
}

async function waitFor(ee, name, func) {
  return new Promise((resolve, reject) => {
    let onEvent, onError;

    const cleanup = () => {
      ee.removeListener(name, onEvent);

      if (name !== 'error')
        ee.removeListener('error', onError);
    };

    onEvent = (res) => {
      cleanup();
      resolve(res);
    };

    onError = (err) => {
      cleanup();
      reject(err);
    };

    ee.on(name, onEvent);

    if (name !== 'error')
      ee.on('error', onError);

    if (func) {
      try {
        func.call(ee);
      } catch (e) {
        onError(e);
      }
    }
  });
}

async function read(worker) {
  return waitFor(worker, 'message');
}

async function wait(worker) {
  return waitFor(worker, 'exit');
}

async function close(port) {
  return waitFor(port, 'close', port.close);
}

async function exit(worker) {
  return waitFor(worker, 'exit', worker.terminate);
}

async function timeout(ms) {
  return new Promise(cb => setTimeout(cb, ms));
}

if (process.browser) {
  register('/eval.js', [__dirname, '../lib/browser/eval.js']);
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
  });

  it('should create message channel', async () => {
    const {port1, port2} = new threads.MessageChannel();

    port1.postMessage({ foo: 1 });

    assert.deepStrictEqual(await read(port2), { foo: 1 });

    await Promise.all([close(port1), close(port2)]);
  });

  it('should create worker with data', async () => {
    const worker = new threads.Worker(vector(1), {
      workerData: 'foo'
    });

    const job = wait(worker);
    const msg = Buffer.from(await read(worker));

    assert.strictEqual(msg.toString(), 'foobar');

    if (threads.browser)
      worker._terminate(0);

    assert.strictEqual(await job, 0);
  });

  it('should have stdin', async () => {
    const worker = new threads.Worker(vector(2), {
      stdin: true
    });

    const job = wait(worker);

    worker.stdin.write('foo\n');

    assert.strictEqual(await read(worker), 'foobar');
    assert.strictEqual(await job, 0);
  });

  it('should not hang if there is no input', async (ctx) => {
    if (threads.browser)
      ctx.skip();

    const worker = new threads.Worker(vector(2), {
      stdin: true
    });

    let called = false;

    worker.on('message', (msg) => {
      called = true;
    });

    assert.strictEqual(await wait(worker), 0);
    assert(!called);
  });

  it('should have stdout', async () => {
    const worker = new threads.Worker(vector(3), {
      workerData: 'foo',
      stdout: true
    });

    worker.stdout.setEncoding('utf8');

    const job = wait(worker);
    const msg = await waitFor(worker.stdout, 'data');

    assert.strictEqual(msg, 'foobar');

    if (threads.browser)
      worker._terminate(0);

    assert.strictEqual(await job, 0);
  });

  it('should have stderr', async () => {
    const worker = new threads.Worker(vector(4), {
      workerData: 'foo',
      stderr: true
    });

    worker.stderr.setEncoding('utf8');

    const job = wait(worker);
    const msg = await waitFor(worker.stderr, 'data');

    assert.strictEqual(msg, 'foobar');

    if (threads.browser)
      worker._terminate(0);

    assert.strictEqual(await job, 0);
  });

  it('should have console.log', async () => {
    const worker = new threads.Worker(vector(5), {
      workerData: 'foo',
      stdout: true
    });

    worker.stdout.setEncoding('utf8');

    const job = wait(worker);
    const msg = await waitFor(worker.stdout, 'data');

    assert.strictEqual(msg, 'foobar\n');

    if (threads.browser)
      worker._terminate(0);

    assert.strictEqual(await job, 0);
  });

  it('should have console.error', async () => {
    const worker = new threads.Worker(vector(6), {
      workerData: 'foo',
      stderr: true
    });

    worker.stderr.setEncoding('utf8');

    const job = wait(worker);
    const msg = await waitFor(worker.stderr, 'data');

    assert.strictEqual(msg, 'foobar\n');

    if (threads.browser)
      worker._terminate(0);

    assert.strictEqual(await job, 0);
  });

  it('should terminate long running thread', async () => {
    const worker = new threads.Worker(vector(7));
    const msg = await read(worker);
    const job = wait(worker);

    worker.terminate();

    assert.strictEqual(msg, 'kill me');
    assert.strictEqual(await job, 1);
  });

  it('should hang on input', async () => {
    const worker = new threads.Worker(vector(8), {
      stdin: true
    });

    let exited = false;

    worker.on('exit', () => {
      exited = true;
    });

    // NOTE: worker_threads hangs even if we're not listening on stdin.
    await timeout(1000);

    assert(!exited);

    assert.strictEqual(await exit(worker), 1);
  });

  it('should open message port with child', async () => {
    const worker = new threads.Worker(vector(9));
    const {port1, port2} = new threads.MessageChannel();

    worker.postMessage(port2, [port2]);

    assert.strictEqual(await read(port1), 'hello world');
    assert.strictEqual(await wait(worker), 0);
  });

  it('should open message port with parent', async () => {
    const worker = new threads.Worker(vector(10));
    const port = await read(worker);

    assert(port instanceof threads.MessagePort);

    port.postMessage('hello world');

    assert.strictEqual(await wait(worker), 0);
  });

  it('should open port between children', async () => {
    const worker1 = new threads.Worker(vector(11));
    const worker2 = new threads.Worker(vector(11));
    const {port1, port2} = new threads.MessageChannel();
    const job = Promise.all([wait(worker1), wait(worker2)]);

    worker1.postMessage(port1, [port1]);
    worker2.postMessage(port2, [port2]);

    const [x, y] = await job;

    assert.strictEqual(x, 0);
    assert.strictEqual(y, 0);
  });

  it('should receive and send port', async () => {
    const worker1 = new threads.Worker(vector(10));
    const worker2 = new threads.Worker(vector(9));
    const job = Promise.all([wait(worker1), wait(worker2)]);

    const port = await read(worker1);

    assert(port instanceof threads.MessagePort);

    worker2.postMessage(port, [port]);

    const [x, y] = await job;

    assert.strictEqual(x, 0);
    assert.strictEqual(y, 0);
  });

  it('should create nested worker to talk to', async () => {
    // NOTE: This was failing _silently_ earlier when
    // 012.js couldn't find 013.js (because it wasn't
    // registered). Investigate. Add errors tests.
    const worker = new threads.Worker(vector(12));
    const job = wait(worker);
    const port = await read(worker);

    assert(port instanceof threads.MessagePort);

    assert.strictEqual(await read(port), 'hello from below');
    assert.strictEqual(await job, 0);
  });

  it('should transfer buffer', async () => {
    const worker = new threads.Worker(vector(14));
    const job = wait(worker);
    const data = Buffer.from('foobar');

    worker.postMessage(data, [data.buffer]);

    const msg = Buffer.from(await read(worker));

    assert.strictEqual(msg.toString(), 'foobar');

    if (threads.backend === 'web_workers'
        || threads.backend === 'worker_threads') {
      assert(data.length === 0);
    }

    assert.strictEqual(await job, 0);
  });

  it('should eval string', async () => {
    function workerThread() {
      const assert = module.require('assert');
      const path = module.require('path');
      const threads = module.require('bthreads');

      assert(threads.parentPort);
      assert.strictEqual(module.id, '[worker eval]');
      assert.strictEqual(path.basename(module.filename), '[worker eval]');
      assert.strictEqual(__dirname, '.');
      assert.strictEqual(__filename, '[worker eval]');
      assert(!threads.source);

      threads.parentPort.postMessage('evaled!');

      setTimeout(() => {
        process.exit(2);
      }, 50);
    }

    const code = `(${workerThread}).call(this);`;
    const worker = new threads.Worker(code, {
      bootstrap: URL,
      eval: true
    });

    assert.strictEqual(await read(worker), 'evaled!');
    assert.strictEqual(await wait(worker), 2);
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

    assert.strictEqual(await thread.close(), 1);
    assert(called);
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
      const assert = module.require('assert');
      const {parent} = module.require('bthreads');

      parent.hook('job', (data) => {
        assert(Buffer.isBuffer(data));
        setTimeout(() => process.exit(0), 50);
        return [data, [data.buffer]];
      });
    }, { bootstrap: URL });

    const data = Buffer.from('foo');
    const result = await thread.call('job', [data], [data.buffer]);

    if (threads.backend === 'web_workers'
        || threads.backend === 'worker_threads') {
      assert(data.length === 0);
    }

    assert(Buffer.isBuffer(result));
    assert(result.length === 3);

    assert.strictEqual(await thread.wait(), 0);
  });

  it('should transfer complex data to thread', async () => {
    const thread = new threads.Thread(() => {
      const {parent} = module.require('bthreads');

      parent.hook('job', (data) => {
        setTimeout(() => process.exit(0), 50);
        return data;
      });
    }, { bootstrap: URL });

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

    assert.strictEqual(await thread.wait(), 0);
  });

  it('should transfer blob to thread', async (ctx) => {
    if (!threads.browser)
      ctx.skip();

    const blob = new Blob(['foobar'], { type: 'text/plain' });

    const thread = new threads.Thread(async () => {
      const {parent, workerData} = module.require('bthreads');

      await parent.call('blob', [workerData]);
    }, { bootstrap: URL, workerData: blob });

    const ret = await new Promise(cb => thread.hook('blob', cb));

    assert.strictEqual(await readBlob(ret), 'foobar');

    await thread.close();
  });

  it('should transfer blob to thread (2)', async (ctx) => {
    if (!threads.browser)
      ctx.skip();

    const blob = new Blob(['foobar'], { type: 'text/plain' });

    const thread = new threads.Thread(async () => {
      const {parent, workerData} = module.require('bthreads');
      parent.send(workerData);
    }, { bootstrap: URL, workerData: blob });

    const ret = await thread.read();

    assert.strictEqual(await readBlob(ret), 'foobar');

    await thread.close();
  });

  it('should import scripts', async (ctx) => {
    if (!threads.browser)
      ctx.skip();

    const thread = new threads.Thread(() => {
      const assert = module.require('assert');
      const threads = module.require('bthreads');

      const _ = threads.importScripts(
        'https://unpkg.com/underscore@1.9.1/underscore.js');

      assert.strictEqual(_.VERSION, '1.9.1');

      console.log(_.VERSION);

      process.exit(0);
    }, { bootstrap: URL, stdout: true });

    // Test stdout while we're at it.
    thread.stdout.setEncoding('utf8');

    const data = await waitFor(thread.stdout, 'data');

    assert.strictEqual(data, '1.9.1\n');
    assert.strictEqual(await thread.wait(), 0);
  });

  it('should send port to thread', async () => {
    const thread = new threads.Thread(() => {
      const {parent} = module.require('bthreads');

      parent.hook('port', (port) => {
        port.hook('job', () => {
          return 'hello';
        });
      });
    }, { bootstrap: URL });

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
      const threads = module.require('bthreads');
      const {parent} = threads;

      let thread;

      parent.hook('spawn', () => {
        thread = new threads.Thread(() => {
          const {parent} = module.require('bthreads');

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
    }, { bootstrap: URL });

    const {port1, port2} = new threads.Channel();

    await thread.call('spawn');
    await thread.call('port', [port1], [port1]);

    assert.strictEqual(await port2.call('job'), 'hello');

    await thread.call('close');

    await port2.close();
    await thread.close();
  });

  it('should close child', async (ctx) => {
    if (threads.browser)
      ctx.skip();

    const worker = new threads.Worker(vector(16));

    assert.strictEqual(await wait(worker), 0);
  });

  it('should bind console without require', async (ctx) => {
    if (threads.browser)
      ctx.skip();

    const worker = new threads.Worker(vector(17), {
      stdout: true
    });

    worker.stdout.setEncoding('utf8');

    const msg = await waitFor(worker.stdout, 'data');

    assert.strictEqual(msg, 'foobar\n');

    if (threads.browser)
      worker._terminate(0);

    assert.strictEqual(await wait(worker), 0);
  });

  it('should test node flags', async (ctx) => {
    if (threads.browser)
      ctx.skip();

    // Added in 11.8.0.
    // https://github.com/nodejs/node/pull/25467
    if (threads.backend === 'worker_threads' && version < 0x0b0800)
      ctx.skip();

    const thread = new threads.Worker(vector(18), {
      execArgv: ['--expose-internals']
    });

    await wait(thread);
  });

  it('should propagate stdout through multiple layers', async (ctx) => {
    if (threads.browser)
      ctx.skip();

    const thread = new threads.Thread(() => {
      const threads = module.require('bthreads');

      new threads.Thread(() => {
        const threads = module.require('bthreads');

        new threads.Thread(() => {
          const threads = module.require('bthreads');

          new threads.Thread(() => {
            console.log('foobar');
          });
        });
      });
    }, { stdout: true });

    const data = await waitFor(thread.stdout, 'data');

    assert.strictEqual(data.toString('utf8'), 'foobar\n');
    assert.strictEqual(await thread.wait(), 0);
  });

  it('should throw error', async () => {
    const thread = new threads.Thread(() => {
      const threads = module.require('bthreads');

      threads.parent.hook('job', () => {
        throw new Error('foobar');
      });
    }, { bootstrap: URL });

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

  it('should propagate exception', async (ctx) => {
    if (threads.backend === 'polyfill')
      ctx.skip();

    const thread = new threads.Thread(() => {
      setImmediate(() => {
        throw new Error('foobar');
      });
    }, { bootstrap: URL });

    let err = null;

    try {
      await thread.wait();
    } catch (e) {
      err = e;
    }

    assert.strictEqual(err && err.message, 'foobar');
    assert.strictEqual(await thread.wait(), 1);
  });

  it('should propagate rejection', async (ctx) => {
    if (threads.backend === 'polyfill')
      ctx.skip();

    const thread = new threads.Thread(() => {
      // Need this for `worker_threads` backend.
      module.require('bthreads');

      setImmediate(() => {
        new Promise((resolve, reject) => {
          reject(new Error('foobar'));
        });
      });
    }, { bootstrap: URL });

    let err = null;

    try {
      await thread.wait();
    } catch (e) {
      err = e;
    }

    assert.strictEqual(err && err.message, 'foobar');
    assert.strictEqual(await thread.wait(), 1);
  });

  it('should set module dirname', async (ctx) => {
    if (threads.browser)
      ctx.skip();

    const cwd = process.cwd();

    process.chdir('/');

    const thread = new threads.Thread(() => {
      const {parent} = module.require('bthreads');
      parent.send([
        process.cwd(),
        __dirname,
        require.resolve('bthreads'),
        require.resolve('./threads-test.js')
      ]);
    }, { dirname: __dirname });

    const msg = await thread.read();

    assert(Array.isArray(msg));
    assert.strictEqual(msg[0], '/');
    assert.strictEqual(msg[1], __dirname);
    assert.strictEqual(msg[2], require.resolve('bthreads'));
    assert.strictEqual(msg[3], require.resolve('./threads-test.js'));

    process.chdir(cwd);

    assert.strictEqual(await thread.wait(), 0);
  });

  // https://github.com/nodejs/node/issues/26463
  it('should not throw on unbind after close', async () => {
    const {port1} = new threads.Channel();
    const fn = () => {};

    port1.on('message', fn);

    await port1.close();

    port1.removeListener('message', fn);
  });

  // https://github.com/nodejs/node/issues/26463
  // Update: the browser backend should mimic node.js behavior now.
  it('should buffer after onmessage removal', async () => {
    const {port1, port2} = new threads.Channel();
    const text = [];

    port1.send('hello');

    await timeout(50);

    text.push(await port2.read());

    port2.removeAllListeners('message');
    port1.send('world');

    await timeout(50);

    text.push(await port2.read());

    port2.removeAllListeners('message');

    assert.strictEqual(text.join(' '), 'hello world');
  });

  for (const name of ['port-close', 'no-port-close']) {
    it(`should emit close remote port (${name})`, async (ctx) => {
      // Browser backend doesn't track all ports yet.
      if (name === 'no-port-close' && threads.browser)
        ctx.skip();

      const {port1, port2} = new threads.Channel();

      const thread = new threads.Thread(() => {
        const threads = module.require('bthreads');
        const {parent, workerData} = threads;
        const name = workerData;

        parent.on('message', (port) => {
          if (name === 'port-close')
            port.close();

          if (threads.browser)
            threads.exit(0);
          else
            parent.close();
        });
      }, { bootstrap: URL, workerData: name });

      let closed = false;

      port2.on('close', () => {
        closed = true;
      });

      thread.send(port1, [port1]);

      await thread.wait();

      assert(closed);
    });
  }

  it('should handle methods and properties for thread', async () => {
    const thread = new threads.Thread(async () => {
      const assert = module.require('assert');
      const {parent} = module.require('bthreads');

      assert.strictEqual(parent.closed, false);

      parent.send(await parent.read());
    }, { bootstrap: URL });

    assert.strictEqual(thread.online, false);
    assert.strictEqual(thread.closed, false);

    await thread.open();

    assert.strictEqual(thread.online, true);
    assert.strictEqual(thread.closed, false);

    thread.send('foobar');

    assert.strictEqual(await thread.read(), 'foobar');

    assert.strictEqual(thread.online, true);
    assert.strictEqual(thread.closed, false);

    await thread.close();

    assert.strictEqual(thread.online, false);
    assert.strictEqual(thread.closed, true);
  });

  it('should handle methods and properties for pool', async () => {
    const pool = new threads.Pool(() => {
      const assert = module.require('assert');
      const {parent} = module.require('bthreads');

      assert.strictEqual(parent.closed, false);

      parent.hook('job', () => 'foobar');
    }, { bootstrap: URL });

    await pool.open();

    assert.strictEqual(await pool.call('job'), 'foobar');

    await pool.close();
  });
});
