// Sends a processed item to RabbitMQ
require("dotenv").config();

const log = require('../../../lib/log');

module.exports = async function (opts) {
  let { db, processedItem, accumulatedPPObj, matchedRule, crawlQueue } = opts;
  log.info(`[PP:MQTransport] [IID: ${processedItem.iid}] [URL: ${processedItem.url}] Starting MQTransport post processer...`);

  if (
    accumulatedPPObj.structuredContent?.title &&
    accumulatedPPObj.structuredContent?.body &&
    processedItem.url
  ) {
    const exchange = process.env.AMQP_EXCHANGE_NAME;
    log.info(`[PP:MQTransport] Sending ${accumulatedPPObj.structuredContent.title} to MQ exchange ${exchange}`);
    global.amqpChannel.publish(
      exchange,
      '',
      Buffer.from(
        JSON.stringify(
          {
            ...accumulatedPPObj.structuredContent,
            url: processedItem.url,
            id: processedItem.iid
          }
        )
      )
    );
  }
}
