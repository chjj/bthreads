'use strict';

const threads = require('../');
const {parent, Pool} = threads;

Buffer.poolSize = 1;

if (threads.isMainThread) {
  const {performance} = require('perf_hooks');

  (async () => {
    const pool = new Pool(__filename);

    {
      const now = performance.now();

      for (let i = 0; i < 10000; i++)  {
        const data = Buffer.alloc(0xaa, 4096);
        await pool.call('kdf', [data], [data.buffer]);
      }

      console.log('serial: %d', performance.now() - now);
    }

    {
      const now = performance.now();
      const jobs = [];

      for (let i = 0; i < 10000; i++)  {
        const data = Buffer.alloc(0xaa, 4096);
        jobs.push(pool.call('kdf', [data], [data.buffer]));
      }

      await Promise.all(jobs);

      console.log('parallel: %s', performance.now() - now);
    }

    await pool.close();
  })().catch((err) => {
    console.error(err.stack);
    process.exit(0);
  });
} else {
  const crypto = require('crypto');

  const sha256 = (data) => {
    const ctx = crypto.createHash('sha256');
    ctx.update(data);
    return ctx.digest();
  };

  // Stupid KDF.
  const kdf = (data) => {
    for (let i = 0; i < 10; i++)
      data = sha256(data);
    return data;
  };

  parent.hook('kdf', (data) => {
    const hash = kdf(data);
    return [hash, [hash.buffer]];
  });
}
