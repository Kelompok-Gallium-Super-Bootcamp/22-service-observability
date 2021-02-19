const { summary } = require('./performance');

async function summarySvc(req, res, { logger, tracer }) {
  const parentSpan = tracer.startSpan('get_summary');
  const span = tracer.startSpan('get_summary_from_db', {
    childOf: parentSpan,
  });
  try {
    const sums = await summary();
    span.finish();
    const span2 = tracer.startSpan('encode_result', {
      childOf: parentSpan,
    });
    res.setHeader('content-type', 'application/json');
    res.write(JSON.stringify(sums));
    res.end();
    span2.finish();
  } catch (err) {
    logger.error('cannot get data from database');
    span.setTag('error', true);
    span.log({
      event: 'error get_data to database',
      message: err?.message,
    });
    span.finish();
    const span2 = tracer.startSpan('encode_result', {
      childOf: parentSpan,
    });
    res.statusCode = 500;
    res.write(JSON.stringify(err?.message || err));
    res.end();
    span2.finish();
    parentSpan.finish();
    return;
  }
  parentSpan.finish();
}

module.exports = {
  summarySvc,
};
