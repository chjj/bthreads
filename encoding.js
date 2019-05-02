/*!
 * encoding.js - object serialization for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 */

const encoding = require('./lib/internal/encoding');

/*
 * Expose
 */

exports.parse = encoding.parse;
exports.stringify = encoding.stringify;
