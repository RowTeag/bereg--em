const path = require('node:path');
const { Readable, Writable } = require('node:stream');

const CHUNK_BYTES = 256 * 1024;

function installDurableFilesystem(fs, sql, dataDirectory) {
  const nativeFs = fs;
  const filesystemOverrides = Object.create(null);
  const promiseOverrides = Object.create(null);
  const promises = new Proxy(nativeFs.promises, {
    get(target, property) {
      return Object.prototype.hasOwnProperty.call(promiseOverrides, property)
        ? promiseOverrides[property]
        : Reflect.get(target, property, target);
    },
    set(_target, property, value) {
      promiseOverrides[property] = value;
      return true;
    }
  });
  fs = new Proxy(nativeFs, {
    get(target, property) {
      if (property === 'promises') return promises;
      return Object.prototype.hasOwnProperty.call(filesystemOverrides, property)
        ? filesystemOverrides[property]
        : Reflect.get(target, property, target);
    },
    set(_target, property, value) {
      filesystemOverrides[property] = value;
      return true;
    }
  });
  const root = path.resolve(dataDirectory);
  const rootPrefix = `${root}${path.sep}`;
  sql.exec(`CREATE TABLE IF NOT EXISTS bereg_files (
    path TEXT NOT NULL,
    chunk INTEGER NOT NULL,
    contents BLOB NOT NULL,
    PRIMARY KEY (path, chunk)
  )`);

  const resolveDataPath = value => {
    const resolved = path.resolve(String(value));
    return resolved === root || resolved.startsWith(rootPrefix) ? resolved : null;
  };
  const isDirectory = value => {
    const resolved = resolveDataPath(value);
    if (!resolved) return false;
    if (resolved === root) return true;
    const prefix = `${resolved}${path.sep}`;
    return [...sql.exec('SELECT path FROM bereg_files WHERE substr(path, 1, length(?)) = ?', prefix, prefix)].length > 0;
  };
  const readBuffer = value => {
    const filePath = resolveDataPath(value);
    if (!filePath) return null;
    const rows = [...sql.exec('SELECT contents FROM bereg_files WHERE path = ? ORDER BY chunk', filePath)];
    if (!rows.length) return null;
    return Buffer.concat(rows.map(row => Buffer.from(row.contents)));
  };
  const writeBuffer = (value, bytes, options = {}) => {
    const filePath = resolveDataPath(value);
    if (!filePath) return false;
    const flag = typeof options === 'string' ? options : options.flag;
    if (flag === 'wx' && readBuffer(filePath) !== null) {
      const error = new Error(`EEXIST: file already exists, open '${filePath}'`);
      error.code = 'EEXIST';
      error.path = filePath;
      throw error;
    }
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    sql.exec('DELETE FROM bereg_files WHERE path = ?', filePath);
    for (let offset = 0, chunk = 0; offset < buffer.length || (offset === 0 && buffer.length === 0); offset += CHUNK_BYTES, chunk += 1) {
      sql.exec('INSERT INTO bereg_files (path, chunk, contents) VALUES (?, ?, ?)', filePath, chunk, buffer.subarray(offset, Math.min(offset + CHUNK_BYTES, buffer.length)));
      if (!buffer.length) break;
    }
    return true;
  };
  const writeMigrationChunk = (value, index, bytes) => {
    const filePath = resolveDataPath(value);
    if (!filePath || !Number.isSafeInteger(index) || index < 0) throw new Error('Invalid migration file chunk.');
    if (index === 0) sql.exec('DELETE FROM bereg_files WHERE path = ?', filePath);
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    sql.exec('INSERT OR REPLACE INTO bereg_files (path, chunk, contents) VALUES (?, ?, ?)', filePath, index, buffer);
  };
  const removeFile = value => {
    const filePath = resolveDataPath(value);
    if (!filePath) return false;
    const existed = readBuffer(filePath) !== null;
    sql.exec('DELETE FROM bereg_files WHERE path = ?', filePath);
    return existed;
  };
  const toEncoding = (buffer, options) => {
    const encoding = typeof options === 'string' ? options : options?.encoding;
    return encoding ? buffer.toString(encoding) : buffer;
  };
  const missing = filePath => {
    const error = new Error(`ENOENT: no such file or directory, open '${filePath}'`);
    error.code = 'ENOENT';
    error.path = String(filePath);
    return error;
  };
  const read = (filePath, options) => {
    const buffer = readBuffer(filePath);
    if (buffer === null) throw missing(filePath);
    return toEncoding(buffer, options);
  };
  const fileStats = filePath => {
    const buffer = readBuffer(filePath);
    if (buffer === null && !isDirectory(filePath)) return null;
    const directory = buffer === null;
    const stats = {
      size: buffer?.length || 0,
      mtime: new Date(0),
      mtimeMs: 0,
      ctime: new Date(0),
      ctimeMs: 0,
      isFile: () => !directory,
      isDirectory: () => directory,
      isSymbolicLink: () => false
    };
    return stats;
  };

  const original = {
    readFileSync: nativeFs.readFileSync.bind(nativeFs),
    writeFileSync: nativeFs.writeFileSync.bind(nativeFs),
    existsSync: nativeFs.existsSync.bind(nativeFs),
    mkdirSync: nativeFs.mkdirSync.bind(nativeFs),
    renameSync: nativeFs.renameSync.bind(nativeFs),
    unlinkSync: nativeFs.unlinkSync.bind(nativeFs),
    readdirSync: nativeFs.readdirSync.bind(nativeFs),
    statSync: nativeFs.statSync.bind(nativeFs),
    stat: nativeFs.stat.bind(nativeFs),
    createReadStream: nativeFs.createReadStream.bind(nativeFs),
    createWriteStream: nativeFs.createWriteStream.bind(nativeFs),
    unlink: nativeFs.unlink.bind(nativeFs),
    promises: nativeFs.promises
  };

  fs.readFileSync = (filePath, options) => resolveDataPath(filePath) ? read(filePath, options) : original.readFileSync(filePath, options);
  fs.writeFileSync = (filePath, data, options) => {
    if (!resolveDataPath(filePath)) return original.writeFileSync(filePath, data, options);
    const bytes = typeof data === 'string' ? Buffer.from(data, typeof options === 'string' ? options : options?.encoding) : Buffer.from(data);
    return writeBuffer(filePath, bytes, options);
  };
  fs.existsSync = filePath => resolveDataPath(filePath) ? readBuffer(filePath) !== null || isDirectory(filePath) : original.existsSync(filePath);
  fs.mkdirSync = (directory, options) => resolveDataPath(directory) ? undefined : original.mkdirSync(directory, options);
  fs.renameSync = (from, to) => {
    if (!resolveDataPath(from) && !resolveDataPath(to)) return original.renameSync(from, to);
    const bytes = readBuffer(from);
    if (bytes === null) throw missing(from);
    writeBuffer(to, bytes);
    removeFile(from);
  };
  fs.unlinkSync = filePath => {
    if (!resolveDataPath(filePath)) return original.unlinkSync(filePath);
    if (!removeFile(filePath)) throw missing(filePath);
  };
  fs.readdirSync = (directory, options) => {
    if (!resolveDataPath(directory)) return original.readdirSync(directory, options);
    const resolved = path.resolve(String(directory));
    const prefix = resolved === root ? rootPrefix : `${resolved}${path.sep}`;
    const names = new Set();
    for (const row of sql.exec('SELECT path FROM bereg_files WHERE substr(path, 1, length(?)) = ?', prefix, prefix)) {
      const rest = String(row.path).slice(prefix.length);
      if (rest) names.add(rest.split(path.sep, 1)[0]);
    }
    const entries = [...names];
    return options?.encoding === 'buffer' ? entries.map(name => Buffer.from(name)) : entries;
  };
  fs.statSync = (filePath, options) => {
    if (!resolveDataPath(filePath)) return original.statSync(filePath, options);
    const stats = fileStats(filePath);
    if (!stats) throw missing(filePath);
    return stats;
  };
  fs.stat = (filePath, callback) => {
    if (!resolveDataPath(filePath)) return original.stat(filePath, callback);
    queueMicrotask(() => {
      const stats = fileStats(filePath);
      callback(stats ? null : missing(filePath), stats || undefined);
    });
  };
  fs.createReadStream = (filePath, options = {}) => {
    if (!resolveDataPath(filePath)) return original.createReadStream(filePath, options);
    const bytes = readBuffer(filePath);
    if (bytes === null) return Readable.from((async function* () { throw missing(filePath); })());
    const start = Number.isInteger(options.start) ? options.start : 0;
    const end = Number.isInteger(options.end) ? options.end + 1 : bytes.length;
    return Readable.from([bytes.subarray(start, end)]);
  };
  fs.createWriteStream = (filePath, options = {}) => {
    if (!resolveDataPath(filePath)) return original.createWriteStream(filePath, options);
    const buffers = [];
    return new Writable({
      write(chunk, encoding, callback) {
        buffers.push(Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk, encoding));
        callback();
      },
      final(callback) {
        try {
          writeBuffer(filePath, Buffer.concat(buffers), options);
          callback();
        } catch (error) {
          callback(error);
        }
      }
    });
  };
  fs.unlink = (filePath, callback) => {
    if (!resolveDataPath(filePath)) return original.unlink(filePath, callback);
    queueMicrotask(() => {
      try {
        if (!removeFile(filePath)) throw missing(filePath);
        callback?.(null);
      } catch (error) {
        callback?.(error);
      }
    });
  };
  fs.promises.readFile = async (filePath, options) => resolveDataPath(filePath) ? read(filePath, options) : original.promises.readFile(filePath, options);
  fs.promises.writeFile = async (filePath, data, options) => {
    if (!resolveDataPath(filePath)) return original.promises.writeFile(filePath, data, options);
    const bytes = typeof data === 'string' ? Buffer.from(data, typeof options === 'string' ? options : options?.encoding) : Buffer.from(data);
    return writeBuffer(filePath, bytes, options);
  };
  fs.promises.unlink = async filePath => {
    if (!resolveDataPath(filePath)) return original.promises.unlink(filePath);
    if (!removeFile(filePath)) throw missing(filePath);
  };

  require('../lib/runtime-fs').setFilesystem(fs);
  return { root, readBuffer, writeBuffer, writeMigrationChunk };
}

module.exports = { installDurableFilesystem };
