const orm = require('./lib/orm');
const storage = require('./lib/storage');
const kv = require('./lib/kv');
const bus = require('./lib/bus');
const { TaskSchema } = require('./tasks/task.model');
const { WorkerSchema } = require('./worker/worker.model');
const workerServer = require('./worker/server');
const tasksServer = require('./tasks/server');
const performanceServer = require('./performance/server');
const { config } = require('./config');
const { createNodeLogger } = require('./lib/logger');
const { createTracer } = require('./lib/tracer');

async function init(ctx) {
  try {
    ctx.logger.info('connect to database');
    await orm.connect([WorkerSchema, TaskSchema], config.database);
    ctx.logger.info('database connected');
  } catch (err) {
    ctx.logger.error('database connection failed');
    process.exit(1);
  }
  try {
    ctx.logger.info('connect to object storage');
    await storage.connect('task-manager', config.storage);
    ctx.logger.info('object storage connected');
  } catch (err) {
    ctx.logger.error('object storage connection failed');
    process.exit(1);
  }
  try {
    ctx.logger.info('connect to message bus');
    await bus.connect(config.bus.host, config.bus);
    ctx.logger.info('message bus connected');
  } catch (err) {
    ctx.logger.error('message bus connection failed');
    process.exit(1);
  }
  try {
    ctx.logger.info('connect to key value store');
    await kv.connect(config.kv);
    ctx.logger.info('key value store connected');
  } catch (err) {
    ctx.logger.error('key value store connection failed');
    process.exit(1);
  }
}

async function onStop() {
  bus.close();
  kv.close();
}

async function main(command) {
  let logger;
  let tracer;
  let ctx;
  switch (command) {
    case 'performance':
      logger = createNodeLogger('info', 'perf-svc');
      tracer = createTracer('perf-svc');
      ctx = {
        logger,
        tracer,
      };
      await init(ctx);
      performanceServer.run(ctx, onStop);
      break;
    case 'task':
      logger = createNodeLogger('info', 'task-svc');
      tracer = createTracer('task-svc');
      ctx = {
        logger,
        tracer,
      };
      await init(ctx);
      tasksServer.run(ctx, onStop);
      break;
    case 'worker':
      logger = createNodeLogger('info', 'worker-svc');
      tracer = createTracer('worker-svc');
      ctx = {
        logger,
        tracer,
      };
      await init(ctx);
      workerServer.run(ctx, onStop);
      break;
    default:
      logger = createNodeLogger('info', 'unknown');
      logger.info(`${command} tidak dikenali`);
      logger.info('command yang valid: task, worker, performance');
  }
}

main(process.argv[2]);
