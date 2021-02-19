const Busboy = require('busboy');
const url = require('url');
const mime = require('mime-types');
const { Writable } = require('stream');
const {
  add,
  cancel,
  done,
  list,
  ERROR_TASK_DATA_INVALID,
  ERROR_TASK_NOT_FOUND,
} = require('./task');
const { saveFile, readFile, ERROR_FILE_NOT_FOUND } = require('../lib/storage');
// eslint-disable-next-line no-unused-vars
const { ClientRequest, IncomingMessage, ServerResponse } = require('http');

/**
 * service to add Task
 * @param {ClientRequest} req
 * @param {ServerResponse} res
 */
function addSvc(req, res, { logger, tracer }) {
  const busboy = new Busboy({ headers: req.headers });
  const data = {
    job: '',
    assigneeId: 0,
    attachment: null,
  };

  let finished = false;

  function abort() {
    const addAbort = tracer.startSpan('add_service_abort');
    const addFile = tracer.startSpan('saving_file', { childOf: addAbort });
    req.unpipe(busboy);
    if (!req.aborted) {
      logger.error(
        `service stopped because of request error | status code ${res.statuscode}`
      );
      addFile.setTag('error', true);
      addFile.log({
        event: 'request error',
        message: 'service stopped because of request error',
      });
      res.statusCode = 500;
      res.write('internal server error');
      addFile.setTag('error', true);
      addFile.log({
        event: 'server error',
        message: 'internal server error',
      });
      res.end();
      addFile.finish();
      addAbort.finish();
    }
    logger.error('service stopped because of busboy error');
    addFile.setTag('error', true);
    addFile.log({
      event: 'service stopped',
      message: 'service stopped because of busboy error',
    });
    addFile.finish();
    addAbort.finish();
  }

  busboy.on('file', async (fieldname, file, filename, encoding, mimetype) => {
    const addParentFile = tracer.startSpan('add_service_file');
    switch (fieldname) {
      case 'attachment': {
        const addFile = tracer.startSpan('saving_file', {
          childOf: addParentFile,
        });
        try {
          data.attachment = await saveFile(file, mimetype);
          logger.info('attachment has been saved in presistent');
        } catch (err) {
          logger.error(`cannot save attachment to presistent, ${err}`);
          addFile.setTag('error', true);
          addFile.log({
            event: 'service stopped',
            message: 'service stopped because of busboy error',
          });
          abort();
          addFile.finish();
        }
        addFile.finish();
        const addField = tracer.startSpan('add_field', {
          childOf: addParentFile,
        });
        if (!req.aborted && finished) {
          try {
            const task = await add(data);
            res.setHeader('content-type', 'application/json');
            logger.info('data has been submitted succesfully');
            res.write(JSON.stringify(task));
          } catch (err) {
            if (err === ERROR_TASK_DATA_INVALID) {
              logger.error('invalid input task data / data not complete');
              res.statusCode = 401;
              addField.setTag('error', true);
              addField.log({
                event: 'invalid input',
                message: 'invalid input task data / data not complete',
              });
              addField.finish();
            } else {
              logger.error('data can not processed');
              addField.setTag('error', true);
              addField.log({
                event: 'data failed processed',
                message: 'data can not processed',
              });
              res.statusCode = 500;
              addField.finish();
            }
            res.write(err);
          }
          res.end();
        }
        addField.finish();
        addParentFile.finish();
        break;
      }
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
    const addParentField = tracer.startSpan('add_service_field');
    const checkField = tracer.startSpan('add_field', {
      childOf: addParentField,
    });
    switch (fieldname) {
      case 'job':
        data.job = val;
        break;
      case 'assignee_id':
        data.assigneeId = parseInt(val, 10);
        break;
    }
    checkField.finish();
    addParentField.finish();
  });

  busboy.on('finish', async () => {
    finished = true;
  });

  req.on('aborted', abort);
  busboy.on('error', abort);
  req.pipe(busboy);
}

/**
 * service to get list of Task
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 */
async function listSvc(req, res, { logger, tracer }) {
  const listParrent = tracer.startSpan('list_service_parent');
  const listChild = tracer.startSpan('list_child', {
    childOf: listParrent,
  });
  try {
    const tasks = await list();
    res.setHeader('content-type', 'application/json');
    logger.info('tasks succesfully loaded');
    res.write(JSON.stringify(tasks));
    res.end();
  } catch (err) {
    const listError = tracer.startSpan('list_child_error', {
      childOf: listParrent,
    });
    logger.error('unkown error, failed to load data');
    listError.setTag('error', true);
    listError.log({
      event: 'data failed processed',
      message: 'data failed to load',
    });
    res.statusCode = 500;
    res.end();
    listError.finish();
    listParrent.finish();
    return;
  }
  listChild.finish();
  listParrent.finish();
}

/**
 * service to set a task to done by id
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 */
async function doneSvc(req, res, { logger, tracer }) {
  const uri = url.parse(req.url, true);
  const id = uri.query['id'];
  const doneParrent = tracer.startSpan('done_parrent');
  if (!id) {
    const doneChildParam = tracer.startSpan('done_failed_parameter', {
      childOf: doneParrent,
    });
    res.statusCode = 401;
    logger.error('parameter not found');
    doneChildParam.setTag('error', true);
    doneChildParam.log({
      event: 'parameter not found',
      message: 'parameter not found',
    });
    res.write('parameter id tidak ditemukan');
    res.end();
    doneChildParam.finish();
    doneParrent.finish();
    return;
  }
  try {
    const doneChild = tracer.startSpan('done_success', {
      childOf: doneParrent,
    });
    const task = await done(id);
    res.setHeader('content-type', 'application/json');
    res.statusCode = 200;
    logger.info('done status has been changed succefully');
    res.write(JSON.stringify(task));
    res.end();
    doneChild.finish();
  } catch (err) {
    const doneChildError = tracer.startSpan('done_error', {
      childOf: doneParrent,
    });
    if (err === ERROR_TASK_NOT_FOUND) {
      res.statusCode = 404;
      logger.error('task is not found ');
      doneChildError.setTag('error', true);
      doneChildError.log({
        event: 'data not found',
        message: 'task not found',
      });
      res.write(err);
      res.end();
      doneChildError.finish();
      doneParrent.finish();
      return;
    }
    res.statusCode = 500;
    logger.error('unkown error when set task to done');
    doneChildError.setTag('error', true);
    doneChildError.log({
      event: 'unkown server error',
      message: 'unkown error when set task to done',
    });
    res.end();
    doneChildError.finish();
    doneParrent.finish();
    return;
  }
  doneParrent.finish();
}

/**
 * service to set a task to cancel by id
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 */
async function cancelSvc(req, res, { logger, tracer }) {
  const uri = url.parse(req.url, true);
  const id = uri.query['id'];
  const cancelParrent = tracer.startSpan('cancel_parrent');
  if (!id) {
    const cancelChildParam = tracer.startSpan('cancel_failed_parameter', {
      childOf: cancelParrent,
    });
    res.statusCode = 401;
    logger.error('parameter not found');
    cancelChildParam.setTag('error', true);
    cancelChildParam.log({
      event: 'parameter not found',
      message: 'parameter not found',
    });
    res.write('parameter id tidak ditemukan');
    res.end();
    cancelChildParam.finish();
    cancelParrent.finish();
    return;
  }
  try {
    const cancelChildSucces = tracer.startSpan('cancel_succesful', {
      childOf: cancelParrent,
    });
    const task = await cancel(id);
    res.setHeader('content-type', 'application/json');
    res.statusCode = 200;
    logger.info('success cancel task');
    res.write(JSON.stringify(task));
    res.end();
    cancelChildSucces.finish();
    cancelParrent.finish();
  } catch (err) {
    const cancelChildError = tracer.startSpan('cancel_error', {
      childOf: cancelParrent,
    });
    if (err === ERROR_TASK_NOT_FOUND) {
      res.statusCode = 404;
      logger.error('cancel can not execute, because of task not found');
      cancelChildError.setTag('error', true);
      cancelChildError.log({
        event: 'data not found',
        message: 'task cannot cancel because task not found',
      });
      res.write(err);
      res.end();
      cancelChildError.finish();
      cancelParrent.finish();
      return;
    }
    res.statusCode = 500;
    logger.error('unkown error when set task to cancel');
    res.end();
    cancelChildError.setTag('error', true);
    cancelChildError.log({
      event: 'unknown server error',
      message: 'unkown error when set task to cancel',
    });
    cancelChildError.finish();
    cancelParrent.finish();
    return;
  }
  cancelParrent.finish();
}

/**
 * service to get attachment of Task
 * @param {ClientRequest} req
 * @param {ServerResponse} res
 */
async function getAttachmentSvc(req, res, { logger, tracer }) {
  const uri = url.parse(req.url, true);
  const objectName = uri.pathname.replace('/attachment/', '');
  const attachmentParrent = tracer.startSpan('attachment_parrent');
  if (!objectName) {
    const attachmentChildReq = tracer.startSpan('attachment_fail_request', {
      childOf: attachmentParrent,
    });
    res.statusCode = 400;
    logger.error('wrong request');
    res.write('request tidak sesuai');
    attachmentChildReq.setTag('error', true);
    attachmentChildReq.log({
      event: 'wrong request',
      message: 'wrong request',
    });
    res.end();
    attachmentChildReq.finish();
  }
  try {
    const attachmentChildSuccess = tracer.startSpan('attachment_success', {
      childOf: attachmentParrent,
    });
    const objectRead = await readFile(objectName);
    res.setHeader('Content-Type', mime.lookup(objectName));
    res.statusCode = 200;
    objectRead.pipe(res);
    logger.info('attachment successfully to request');
    attachmentChildSuccess.finish();
  } catch (err) {
    const attachmentChildError = tracer.startSpan('attachment_error', {
      childOf: attachmentParrent,
    });
    if (err === ERROR_FILE_NOT_FOUND) {
      res.statusCode = 404;
      res.write(err);
      logger.error(
        'failed to load attachment, because of attachment not found'
      );
      attachmentChildError.setTag('error', true);
      attachmentChildError.log({
        event: 'failed to load',
        message: 'failed to load attachment, because of attachment not found',
      });
      res.end();
      attachmentChildError.finish();
      attachmentParrent.finish();
      return;
    }
    res.statusCode = 500;
    res.write('gagal membaca file');
    logger.error('unknown error to read file');
    res.end();
    attachmentChildError.finish();
    attachmentParrent.finish();
    return;
  }
  attachmentParrent.finish();
}

module.exports = {
  listSvc,
  addSvc,
  doneSvc,
  cancelSvc,
  getAttachmentSvc,
};
