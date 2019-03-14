/*!
 * inspect.js - browser inspect for bthreads
 * Copyright (c) 2019, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bthreads
 *
 * Parts of this software are based on defunctzombie/node-util:
 *   Copyright (c) 2019, Joyent (MIT)
 *   https://github.com/defunctzombie/node-util
 *
 * License for util@0.11.1:
 *
 * Copyright Joyent, Inc. and other Node contributors. All rights reserved.
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

'use strict';

/*
 * Format
 */

function format(f) {
  if (!isString(f)) {
    const objects = [];

    for (let i = 0; i < arguments.length; i++)
      objects.push(inspect(arguments[i]));

    return objects.join(' ');
  }

  const args = arguments;
  const len = args.length;

  let i = 1;

  let str = String(f).replace(/%[sdj%]/g, (x) => {
    if (x === '%%')
      return '%';

    if (i >= len)
      return x;

    switch (x) {
      case '%s':
        return String(args[i++]);
      case '%d':
        return Number(args[i++]);
      case '%j':
        try {
          return JSON.stringify(args[i++]);
        } catch (e) {
          return '[Circular]';
        }
    }

    return x;
  });

  for (let x = args[i]; i < len; x = args[++i]) {
    if (isNull(x) || !isObject(x))
      str += ' ' + x;
    else
      str += ' ' + inspect(x);
  }

  return str;
}

/*
 * Inspect
 */

function inspect(obj, opts) {
  const ctx = { seen: [] };

  if (arguments.length >= 3)
    ctx.depth = arguments[2];

  if (isBoolean(opts)) {
    ctx.showHidden = opts;
  } else if (opts) {
    ctx.showHidden = opts.showHidden;
    ctx.depth = opts.depth;
    ctx.customInspect = opts.customInspect;
  }

  if (isUndefined(ctx.showHidden))
    ctx.showHidden = false;

  if (isUndefined(ctx.depth))
    ctx.depth = 2;

  if (isUndefined(ctx.customInspect))
    ctx.customInspect = true;

  return formatValue(ctx, obj, ctx.depth);
}

/*
 * Helpers
 */

function formatValue(ctx, value, recurseTimes) {
  if (ctx.customInspect
      && value
      && isFunction(value.inspect)
      && value.inspect !== inspect
      && !(value.constructor && value.constructor.prototype === value)) {
    let ret = value.inspect(recurseTimes, ctx);

    if (!isString(ret))
      ret = formatValue(ctx, ret, recurseTimes);

    return ret;
  }

  const primitive = formatPrimitive(ctx, value);

  if (primitive)
    return primitive;

  let keys = Object.keys(value);

  const visibleKeys = arrayToHash(keys);

  if (ctx.showHidden)
    keys = Object.getOwnPropertyNames(value);

  if (isError(value)
      && (keys.indexOf('message') !== -1
          || keys.indexOf('description') !== -1)) {
    return formatError(value);
  }

  if (keys.length === 0) {
    if (isFunction(value)) {
      const name = value.name ? ': ' + value.name : '';
      return '[Function' + name + ']';
    }

    if (isRegExp(value))
      return RegExp.prototype.toString.call(value);

    if (isDate(value))
      return Date.prototype.toString.call(value);

    if (isError(value))
      return formatError(value);
  }

  let array = false;
  let braces = ['{', '}'];
  let base = '';

  if (isArray(value)) {
    array = true;
    braces = ['[', ']'];
  }

  if (isFunction(value)) {
    const n = value.name ? ': ' + value.name : '';
    base = ' [Function' + n + ']';
  }

  if (isRegExp(value))
    base = ' ' + RegExp.prototype.toString.call(value);

  if (isDate(value))
    base = ' ' + Date.prototype.toUTCString.call(value);

  if (isError(value))
    base = ' ' + formatError(value);

  if (keys.length === 0 && (!array || value.length === 0))
    return braces[0] + base + braces[1];

  if (recurseTimes < 0) {
    if (isRegExp(value))
      return RegExp.prototype.toString.call(value);

    return '[Object]';
  }

  ctx.seen.push(value);

  let output;

  if (array) {
    output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
  } else {
    output = [];

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];

      output.push(formatProperty(ctx, value, recurseTimes,
                                 visibleKeys, key, array));
    }
  }

  ctx.seen.pop();

  return reduceToSingleString(output, base, braces);
}

/*
 * Helpers
 */

function formatPrimitive(ctx, value) {
  if (isUndefined(value))
    return 'undefined';

  if (isString(value)) {
    return '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                       .replace(/'/g, '\\\'')
                                       .replace(/\\"/g, '"') + '\'';
  }

  if (isNumber(value))
    return String(value);

  if (isBoolean(value))
    return String(value);

  if (isNull(value))
    return 'null';

  return undefined;
}

function formatError(value) {
  return '[' + Error.prototype.toString.call(value) + ']';
}

function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
  const output = [];

  for (let i = 0, l = value.length; i < l; ++i) {
    if (hasOwnProperty(value, String(i))) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          String(i), true));
    } else {
      output.push('');
    }
  }

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];

    if (/^\d+$/.test(key))
      continue;

    output.push(formatProperty(ctx, value, recurseTimes,
                               visibleKeys, key, true));
  }

  return output;
}

function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
  let desc = Object.getOwnPropertyDescriptor(value, key);
  let name, str;

  if (!desc)
    desc = { value: value[key] };

  if (desc.get) {
    if (desc.set)
      str = '[Getter/Setter]';
    else
      str = '[Getter]';
  } else {
    if (desc.set)
      str = '[Setter]';
  }

  if (!hasOwnProperty(visibleKeys, key))
    name = '[' + key + ']';

  if (!str) {
    if (ctx.seen.indexOf(desc.value) === -1) {
      if (isNull(recurseTimes))
        str = formatValue(ctx, desc.value, null);
      else
        str = formatValue(ctx, desc.value, recurseTimes - 1);

      if (str.indexOf('\n') !== -1) {
        if (array) {
          str = str.split('\n')
                   .map(line => '  ' + line)
                   .join('\n')
                   .substring(2);
        } else {
          str = '\n' + str.split('\n')
                          .map(line => '   ' + line)
                          .join('\n');
        }
      }
    } else {
      str = '[Circular]';
    }
  }

  if (isUndefined(name)) {
    if (array && /^\d+$/.test(key))
      return str;

    name = JSON.stringify(String(key));

    if (/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/.test(name)) {
      name = name.substring(1, name.length - 2);
    } else {
      name = name.replace(/'/g, '\\\'')
                 .replace(/\\"/g, '"')
                 .replace(/(^"|"$)/g, '\'');
    }
  }

  return name + ': ' + str;
}

function arrayToHash(array) {
  const hash = {};

  for (let i = 0; i < array.length; i++)
    hash[array[i]] = true;

  return hash;
}

function reduceToSingleString(output, base, braces) {
  let length = 0;

  for (let i = 0; i < output.length; i++)
    length += output[i].length + 1;

  if (length > 60) {
    return braces[0]
         + (base === '' ? '' : base + '\n ')
         + ' '
         + output.join(',\n  ')
         + ' '
         + braces[1];
  }

  return braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
}

function isArray(ar) {
  return Array.isArray(ar);
}

function isBoolean(arg) {
  return typeof arg === 'boolean';
}

function isNull(arg) {
  return arg === null;
}

function isNumber(arg) {
  return typeof arg === 'number';
}

function isString(arg) {
  return typeof arg === 'string';
}

function isUndefined(arg) {
  return arg === void 0;
}

function isRegExp(re) {
  return isObject(re) && objectToString(re) === '[object RegExp]';
}

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

function isDate(d) {
  return isObject(d) && objectToString(d) === '[object Date]';
}

function isError(e) {
  return isObject(e)
      && (objectToString(e) === '[object Error]' || e instanceof Error);
}

function isFunction(arg) {
  return typeof arg === 'function';
}

function objectToString(o) {
  return Object.prototype.toString.call(o);
}

function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

/*
 * Expose
 */

exports.format = format;
exports.inspect = inspect;
