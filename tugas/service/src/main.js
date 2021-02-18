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

async function init() {
  const logger = createNodeLogger('info', 'presistent');
  try {
    logger.info('connect to database');
    await orm.connect([WorkerSchema, TaskSchema], config.database);
    logger.info('database connected');
  } catch (err) {
    logger.error('database connection failed');
    process.exit(1);
  }
  try {
    logger.info('connect to object storage');
    await storage.connect('task-manager', config.storage);
    logger.info('object storage connected');
  } catch (err) {
    logger.error('object storage connection failed');
    process.exit(1);
  }
  try {
    logger.info('connect to message bus');
    await bus.connect(config.bus.host, config.bus);
    logger.info('message bus connected');
  } catch (err) {
    logger.error('message bus connection failed');
    process.exit(1);
  }
  try {
    logger.info('connect to key value store');
    await kv.connect(config.kv);
    logger.info('key value store connected');
  } catch (err) {
    logger.error('key value store connection failed');
    process.exit(1);
  }
}

async function onStop() {
  bus.close();
  kv.close();
}

async function main(command) {
  switch (command) {
    case 'performance': {
      const logger = createNodeLogger('info', 'perf-svc');
      const tracer = createTracer('perf-svc');
      const ctx = {
        logger,
        tracer,
      };

      await init(ctx);
      performanceServer.run(ctx, onStop);
      break;
    }
    case 'task': {
      const logger = createNodeLogger('info', 'task-svc');
      const tracer = createTracer('task-svc');
      const ctx = {
        logger,
        tracer,
      };
      await init(ctx);
      tasksServer.run(ctx, onStop);
      break;
    }
    case 'worker': {
      const logger = createNodeLogger('info', 'worker-svc');
      const tracer = createTracer('worker-svc');
      const ctx = {
        logger,
        tracer,
      };
      await init(ctx);
      workerServer.run(ctx, onStop);
      break;
    }
    default: {
      const logger = createNodeLogger('info', 'unknown');
      logger.info(`${command} tidak dikenali`);
      logger.info('command yang valid: task, worker, performance');
    }
  }
}

main(process.argv[2]);
