/** @module WorkerService */
const Busboy = require('busboy');
const url = require('url');
const mime = require('mime-types');
const { Writable } = require('stream');
const {
  register,
  list,
  remove,
  info,
  ERROR_REGISTER_DATA_INVALID,
  ERROR_WORKER_NOT_FOUND,
} = require('./worker');
const { saveFile, readFile, ERROR_FILE_NOT_FOUND } = require('../lib/storage');
// eslint-disable-next-line no-unused-vars
const { ClientRequest, IncomingMessage, ServerResponse } = require('http');

/**
 * service to regiser worker
 * @param {ClientRequest} req
 * @param {ServerResponse} res
 */
function registerSvc(req, res, { logger, tracer }) {
  const busboy = new Busboy({ headers: req.headers });

  const data = {
    name: '',
    age: 0,
    bio: '',
    address: '',
    photo: '',
  };

  let finished = false;

  function abort() {
    const parentSpan1 = tracer.startSpan('add_service_abort');
    const span5 = tracer.startSpan1('menyimpan file', {
      childOf: parentSpan1,
    });
    req.unpipe(busboy);
    if (!req.aborted) {
      logger.error('service stopped because of request error');
      span5.setTag('error', true);
      span5.log({
        event: 'request error',
        message: 'service stopped because of request error',
      });
      res.statusCode = 413;
      res.end();
      span5.finish();
      parentSpan1.finish();
    }
  }

  busboy.on('file', async (fieldname, file, filename, encoding, mimetype) => {
    switch (fieldname) {
      case 'photo':
        {
          const parentSpan = tracer.startSpan('add_service_file');
          const span = tracer.startSpan('menyimpan file', {
            childOf: parentSpan,
          });
          try {
            data.photo = await saveFile(file, mimetype);
            logger.info('photo disimpan');
          } catch (err) {
            logger.error('photo is null');
            span.setTag('error', true);
            span.log({
              event: 'service stopped',
              message: 'service stopped because of busboy error',
            });
            abort();
            span.finish();
          }
          const span1 = tracer.startSpan('write_worker_on_db', {
            childOf: parentSpan,
          });
          if (!req.aborted && finished) {
            try {
              const worker = await register(data);
              logger.info('worker berhasil ditambahkan');
              res.setHeader('content-type', 'application/json');
              const span2 = tracer.startSpan('encode_result', {
                childOf: parentSpan,
              });
              res.write(JSON.stringify(worker));
              span2.finish();
            } catch (err) {
              if (err === ERROR_REGISTER_DATA_INVALID) {
                res.statusCode = 401;
                logger.error('ERROR_REGISTER_DATA_INVALID');
                span1.setTag('error', true);
                span1.log({
                  event: 'error write to database',
                  message: err.message,
                });
              } else {
                res.statusCode = 500;
                logger.error('data worker tidak lengkap');
                span1.setTag('error', true);
                span1.log({
                  event: 'error parsing body',
                  message: 'parameter worker tidak valid',
                });
              }
              const span2 = tracer.startSpan('encode_result', {
                childOf: parentSpan,
              });
              res.write(err);
              span2.finish();
            }
            res.end();
          }
          span.finish();
          parentSpan.finish();
        }
        break;
      default: {
        const noop = new Writable({
          write(chunk, encding, callback) {
            setImmediate(callback);
          },
        });
        file.pipe(noop);
      }
    }
  });

  busboy.on('field', (fieldname, val) => {
    const parentSpan2 = tracer.startSpan('add_service_field');
    const span3 = tracer.startSpan('menyimpan worker', {
      childOf: parentSpan2,
    });
    if (['name', 'age', 'bio', 'address'].includes(fieldname)) {
      data[fieldname] = val;
    }
    span3.finish();
    parentSpan2.finish();
  });

  busboy.on('finish', async () => {
    finished = true;
  });

  req.on('aborted', abort);
  busboy.on('error', abort);

  req.pipe(busboy);
}

/**
 * service to get list of workers
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 */
async function listSvc(req, res, { logger, tracer }) {
  const parentSpan = tracer.startSpan('get_list');
  const span = tracer.startSpan('getlist', {
    childOf: parentSpan,
  });
  try {
    const workers = await list();
    span.finish();
    res.setHeader('content-type', 'application/json');
    const span1 = tracer.startSpan('encode_result', {
      childOf: parentSpan,
    });
    res.write(JSON.stringify(workers));
    res.end();
    span1.finish();
  } catch (err) {
    span.finish();
    res.statusCode = 500;
    res.end();
    span.finish();
    return;
  }
  parentSpan.finish();
}

/**
 * service to get info workers
 * @param {ClientRequest} req
 * @param {ServerResponse} res
 */
async function infoSvc(req, res, { logger, tracer }) {
  const uri = url.parse(req.url, true);
  const id = uri.query['id'];
  const parentSpan = tracer.startSpan('get_by_id');
  if (!id) {
    const span = tracer.startSpan('getById', {
      childOf: parentSpan,
    });
    res.statusCode = 401;
    logger.error('id is null');
    span.setTag('error', true);
    span.log({
      event: 'error parsing body',
      message: 'parameter id tidak ada',
    });
    res.write('parameter id tidak ditemukan');
    res.end();
    span.finish();
    parentSpan.finish();
    return;
  }
  try {
    const span1 = tracer.startSpan('membaca worker dari database', {
      childOf: parentSpan,
    });
    const worker = await info(id);
    span1.finish();
    logger.info('worker ditemukan');
    res.setHeader('content-type', 'application/json');
    const span2 = tracer.startSpan('encode_result', {
      childOf: parentSpan,
    });
    res.write(JSON.stringify(worker));
    res.end();
    span2.finish();
  } catch (err) {
    const span3 = tracer.startSpan('membaca worker dari database', {
      childOf: parentSpan,
    });
    if (err === ERROR_WORKER_NOT_FOUND) {
      logger.error('worker tidak ditemukan ');
      span3.setTag('error', true);
      span3.log({
        event: 'error read to database',
        message: 'worker tidak ditemukan',
      });
      res.statusCode = 404;
      res.write(err);
      res.end();
      span3.finish();
      parentSpan.finish();
      return;
    }
    logger.error('error ketika akan menghapus worker');
    span3.setTag('error', true);
    span3.log({
      event: 'error read to database',
      message: 'error ketika akan menghapus worker',
    });
    res.statusCode = 500;
    res.end();
    span3.finish();
    parentSpan.finish();
    return;
  }
  parentSpan.finish();
}

/**
 * service to remove a worker by id
 * @param {ClientRequest} req
 * @param {ServerResponse} res
 */
async function removeSvc(req, res, { logger, tracer }) {
  const uri = url.parse(req.url, true);
  const id = uri.query['id'];
  const parentSpan = tracer.startSpan('hapus');
  if (!id) {
    const span = tracer.startSpan('hapus', {
      childOf: parentSpan,
    });
    logger.error('id is null');
    span.setTag('error', true);
    span.log({
      event: 'error parsing body',
      message: 'parameter id tidak ada',
    });
    res.statusCode = 401;
    res.write('parameter id tidak ditemukan');
    res.end();
    span.finish();
    parentSpan.finish();
    return;
  }
  try {
    const span1 = tracer.startSpan('mengapus worker dari database', {
      childOf: parentSpan,
    });
    const worker = await remove(id);
    res.setHeader('content-type', 'application/json');
    res.statusCode = 200;
    logger.info('berhasil mengapus worker');
    const span2 = tracer.startSpan('encode_result', {
      childOf: parentSpan,
    });
    res.write(JSON.stringify(worker));
    res.end();
    span1.finish();
    span2.finish();
  } catch (err) {
    const span3 = tracer.startSpan('mengapus worker dari database', {
      childOf: parentSpan,
    });
    if (err === ERROR_WORKER_NOT_FOUND) {
      logger.error('worker tidak ditemukan');
      span3.setTag('error', true);
      span3.log({
        event: 'data not found',
        message: 'worker tidak ditemukan',
      });
      res.statusCode = 404;
      res.write(err);
      res.end();
      span3.finish();
      parentSpan.finish();
      return;
    }
    logger.error('error ketika akan menghapus worker');
    span3.setTag('error', true);
    span3.log({
      event: 'error read to database',
      message: 'error ketika akan menghapus worker',
    });
    res.statusCode = 500;
    res.end();
    span3.finish();
    parentSpan.finish();
    return;
  }
  parentSpan.finish();
}

/**
 *  service to get a photo of worker
 * @param {ClientRequest} req
 * @param {ServerResponse} res
 */
async function getPhotoSvc(req, res, { logger, tracer }) {
  const uri = url.parse(req.url, true);
  const objectName = uri.pathname.replace('/photo/', '');
  const parentSpan = tracer.startSpan('get photo');
  if (!objectName) {
    const span = tracer.startSpan('parsing body', {
      childOf: parentSpan,
    });
    logger.error('photo is null');
    span.setTag('error', true);
    span.log({
      event: 'error parsing body',
      message: 'parameter photo tidak ada',
    });
    res.statusCode = 400;
    res.write('request tidak sesuai');
    res.end();
    span.finish();
    parentSpan.finish();
  }
  try {
    const span1 = tracer.startSpan('berhasil mengambil photo', {
      childOf: parentSpan,
    });
    const objectRead = await readFile(objectName);
    res.setHeader('Content-Type', mime.lookup(objectName));
    res.statusCode = 200;
    objectRead.pipe(res);
    logger.info('berhasil mengambil photo');
    span1.finish();
  } catch (err) {
    const span2 = tracer.startSpan('berhasil mengambil photo', {
      childOf: parentSpan,
    });
    if (err === ERROR_FILE_NOT_FOUND) {
      logger.error('photo tidak ditemukan');
      span2.setTag('error', true);
      span2.log({
        event: 'data not found',
        message: 'photo tidak ditemukan',
      });
      res.statusCode = 404;
      res.write(err);
      res.end();
      span2.finish();
      parentSpan.finish();
      return;
    }
    logger.error('gagal membaca file photo');
    span2.setTag('error', true);
    span2.log({
      event: 'failed to load',
      message: 'gagal membaca file photo',
    });
    res.statusCode = 500;
    res.write('gagal membaca file');
    res.end();
    span2.finish();
    parentSpan.finish();
    return;
  }
  parentSpan.finish();
}

module.exports = {
  listSvc,
  registerSvc,
  infoSvc,
  removeSvc,
  getPhotoSvc,
};
