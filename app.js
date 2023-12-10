const log = require('./lib/log'); require('./lib/log/banner');
const startTime = Date.now();

const amqplib = require('amqplib');
require('events').EventEmitter.defaultMaxListeners = Infinity;

const db = require('./src/Database');
const CrawlQueue = require('./src/CrawlQueue');
const CrawlRuleMatcher = require('./src/post_processing/CrawlRuleMatcher');
const PostProcessingDefaults = require('./src/post_processing/PostProcessingDefaults');
const crawlRuleset = require('./crawl_rules/news');

(async () => {
  const amqpConnection = await amqplib.connect(`amqp://${process.env.AMQP_USER}:${process.env.AMQP_PASSWORD}@${process.env.AMQP_HOST}`);
  global.amqpChannel = await amqpConnection.createChannel();

  // Create fanout exchange (needed for multiple queues)
  global.amqpChannel.assertExchange(process.env.AMQP_EXCHANGE_NAME, 'fanout');

  const queueName = `${process.env.AMQP_QUEUE_PREFIX}-queue`;

  // Create queue and bind to exchange
  global.amqpChannel.assertQueue(queueName);
  global.amqpChannel.bindQueue(queueName, process.env.AMQP_EXCHANGE_NAME);
})();

// Initialise the queue and load in any unprocessed items from the last time NetWatch was running.
const crawlQueue = new CrawlQueue({
  ruleset: crawlRuleset,
  // loadQueueFile: true
});

const crawlRuleMatcher = new CrawlRuleMatcher(crawlRuleset);

// What to do with each queue item after a response is returned?
crawlQueue.events.on('itemProcessed', async (processedItem) => {

  // 1. Load the CrawlRule for the page we are performing post processing on.
  let matchedRule = crawlRuleMatcher.findMostSpecificRule(processedItem);

  // There is no matched rule for this processedItem - so load the defaults.
  if (!matchedRule) {
    log.warn("[RULE] Warning: using default ruleset for: ", processedItem);
    matchedRule = crawlRuleMatcher.loadDefault(processedItem);
  } else {
    // If there's not a fully formed matched rule object, merge in default properties to create a full object.
    matchedRule = { ...crawlRuleMatcher.loadDefault(processedItem), ...matchedRule }
  }

  log.info("Matched Rule: ", matchedRule);

  // 2. Check if that crawl rule has a postProcess property (an array of file names). If it does,
  //    import these files & run them. If it doesn't, load the defaults from the mime type of the response.
  let postProcessingModules = [];

  if (matchedRule.postProcess && Array.isArray(matchedRule.postProcess)) {
    postProcessingModules = matchedRule.postProcess;
  } else {
    // Load the default post processing functions from PostProcessingDefaults from the Content Type header.
    try {
      const headers = processedItem.response.headers();
      const contentType = headers['content-type'].split(/\:|\s+/g)[0].replace(";", "");
      log.info(`[PP] Loading post processing modules for ${contentType}`);
      postProcessingModules = PostProcessingDefaults(contentType);
    } catch (e) {
      // Fallback to HTML if there's an error extracting the content type from the response headers.
      postProcessingModules = PostProcessingDefaults('text/html');
    }
  }

  // 3. Load the postProcessing files from their string names and execute them in series - passing the output of one to the next in the series (this is the accululatedPPObj).
  const postProcessingFunctions = postProcessingModules.map((ppModule) => {
    return require(`./src/post_processing/${ppModule}`);
  });

  // Keeps track of the return values for each of the postProcessingFunctions.
  // Data is accumulated in this one var, the functions can all modify it in series. 
  let accumulatedPPObj = {};

  try {
    for (let i = 0; i < postProcessingFunctions.length; i++) {
      accumulatedPPObj = await postProcessingFunctions[i]({
        db,
        processedItem,
        accumulatedPPObj,
        matchedRule,
        crawlQueue
      });
    }
    log.success(`[PP] [IID: ${processedItem.iid}] Completed post processing of ${processedItem.url}`);
  } catch (e) {
    log.warn("[PP] Error", e)
  }
  // log.info("accumulatedPPObj", accumulatedPPObj);
});

crawlQueue.start();


process.on('SIGUSR2', function () {
  log.grey("\n\n=======================================================================================");
  log.success(`Stopping crawl queue gracefully. Process will close in ${crawlQueue.config.throttle.time * 1.5}ms.`);
  log.success(`[STATS] ${crawlQueue.totalCrawled} items crawled since ${new Date(startTime)}.`);
  log.success(`[STATS] ${crawlQueue.totalCrawled / ((Date.now() - startTime) / 1000 / 60)} req/min avg.`);

  crawlQueue.stop();
  setTimeout(() => {
    log.success("Shutting down and saving current crawl queues to file.");
    crawlQueue.save();
    process.exit()
  }, crawlQueue.config.throttle.time * 1.5);
});

process.on('SIGINT', function () {
  log.grey("\n\n=======================================================================================");
  log.success("Shutting down and saving current crawl queues to file.");
  log.success(`[STATS] ${crawlQueue.totalCrawled} items crawled since ${new Date(startTime)}.`);
  log.success(`[STATS] ${crawlQueue.totalCrawled / ((Date.now() - startTime) / 1000 / 60)} req/min avg.`);
  crawlQueue.save();
  process.exit();
});