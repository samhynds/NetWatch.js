const log = require('../lib/log');
const EventEmitter = require('events');
const fs = require('fs');
const Request = require('./Request');
const md5 = require('md5');
const Schedule = require('./Schedule');

// Class representing everyting that needs to be crawled.
// Runs according to a ruleset which is specified 
class CrawlQueue {
  constructor(opts = {}) {
    log.info(`[CQ] Initialising crawl queue`);

    this.ruleset = opts.ruleset || {};
    this.config = { ...this.defaultConfig, ...this.ruleset.config };

    this.isRunning = false;
    this.baseUrlMatch = /^https?:\/\/[^#?\/]+/;
    this.reqLimitReached = false;
    this.queue = this.ruleset.initialURLs || []; // All items that haven't been processed yet.
    this.recrawlQueue = {};

    this.active = []; // Currently active items, i.e. items being requested.
    this.history = []; // Keeps track of active items over history so we can check for rate limiting purposes.
    this.rateLimitTimer = {}; // If we get an HTTP 429 response, add the URL here so we can exponentially backoff.

    // Set up event emitter and listener
    this.events = new EventEmitter();

    // Ensure that the history array doesn't become too big and clean it up every now and then.
    this.historyCleaner = this.initHistoryCleaner();

    this.schedule = new Schedule();

    // Watch for additions to the queue. Also ensures that the application doesn't exit when the
    // queue is empty as more items may be added later on by the recrawler.
    this.queueWatcher = this.initQueueWatcher();

    // Start the recrawl queue if one was specified
    this.recrawlQueueInterval = this.initRecrawler();

    // Load previous queue data from file
    if (opts.loadQueueFile) {
      this.load();
    }

    (async () => {
      this.events.on('itemProcessed', await this.postProcess.bind(this));
    })();

    // Number of items waiting to cooldown before being crawled
    this.cooldownCount = 0;

    this.totalCrawled = 0;

    this._DEBUG = true;
    if (this._DEBUG) {
      // Init a simple request counter to see if we're adhering to rate limits.
      setInterval(() => {
        log.info(`[STATS] It's been ${this.config.throttle.time}ms and ${this.totalCrawled} requests have been made. Should be limited to ${this.config.throttle.maxRequests} requests every ${this.config.throttle.time}ms.`);
      }, this.config.throttle.time);

      setInterval(() => {
        log.info(`[STATS] Queue lengths.\n Active queue: ${this.active.length} items.\n Main queue: ${this.queue.length} items.\n Cooldown queue: ${this.cooldownCount} items.\n`);
        log.info("[STATS] Active queue:", this.active);
      }, this.config.throttle.time);
    }
  }

  // Queue processing methods
  async start(opts = {}) {
    log.info(`[CQ] Starting crawl queue`);
    this.isRunning = true;

    // Check how many items are currently active.
    if (this.active.length < this.config.maxParallelRequests) {
      let numOfItemsToAdd = opts.numOfItemsToAdd ? Math.min((this.config.maxParallelRequests - this.active.length), opts.numOfItemsToAdd) : Math.min((this.config.maxParallelRequests - this.active.length), this.queue.length);
      log.info(`[CQ] Adding ${numOfItemsToAdd} items to the active queue`);

      // Add items to fill up the active array.
      for (let i = 0; i < numOfItemsToAdd; i++) {
        if (this.queue.length === 0) {
          log.warn(`[CQ] Attempting to add items to the active queue, but the main queue is empty.`);
          this.schedule.addItem({
            runTime: Date.now() + this.config.throttle.time,
            run: () => {
              if (this.isRunning) {
                this.start();
              }
            }
          });
          return;
        }
        let nextItem = this.queue[0];
        log.info(`[CQ] Adding Item to active queue: ${nextItem}`);

        // Try to add an item to the active array and if it fails, try the next item.
        try {
          await this.addActiveItem();
        } catch (e) {
          log.error(`[CQ] [ERR_${e.type}] ${e.message}`);
          if (e.type !== "QueueEmpty" && e.type !== "ReqLimitReached") {
            numOfItemsToAdd++;
          }
        }
      }

      // All items have been added to the active array. Start listening to see when they've finished so we can add more.

    } else {
      log.warn(`[CQ] Active items are full, can't add any more. There are ${this.active.length} items and the max is ${this.config.maxParallelRequests}`);
    }
  }

  // Initialises the recrawler...
  initRecrawler() {
    log.info(`[CQ] Initialising Recrawler...`);

    return setInterval(() => {
      log.info(`[CQ] Adding recrawl items to start of queue`);
      this.addItemsToStart(Object.keys(this.recrawlQueue));
    }, this.config.recrawlInterval);
  }

  addUrlToRecrawler(url) {
    this.recrawlQueue[url] = 1;
  }

  // Note: stopping the queue from processing will not stop items which have been added as
  // cooldown timers
  stop() {
    log.warn(`[CQ] Stopping crawl queue`);
    this.isRunning = false;
    clearInterval(this.queueWatcher);
    clearInterval(this.recrawlQueueInterval);
    this.queueWatcher = null;
    this.recrawlQueueInterval = null;
  }

  // Run on every item in the active array. Emits an event when finished which calls 'postProcess'
  async process(item) {
    log.info(`[CQ:P] Processing ${item.url}`);
    let response;

    try {
      const request = await new Request({
        followRedirects: this.config.followRedirects,
        internalRedirectsOnly: this.config.internalRedirectsOnly
      });
      log.info(`[REQ] [IID: ${item.iid}] Making request to ${item.url}`);
      response = await request.getAxios({
        url: item.url,
        baseUrl: item.baseUrl
      });

      // Request was successful at this point, so remove any rate limiting to this URL.
      if (this.rateLimitTimer[item.baseUrl]) {
        delete this.rateLimitTimer[item.baseUrl];
      }
    } catch (e) {
      log.error(`[REQ] [IID: ${item.iid}] Error making request to ${item.url}`, e.message);
      response = {
        url: item.url,
        baseUrl: item.baseUrl,
        isRateLimited: e.response?.status === 429,
        retryAfter: e.response?.headers['retry-after']
      }
    }

    // Emit event in both cases - request succeeded or didn't as we need to remove it from the active
    // queue in any case. The event listener is responsible for checking if the request was successful.
    this.events.emit('itemProcessed', { ...item, ...response });
  }

  // triggered by an event after an item has been processed.
  // should remove that item from the active array
  // should then add another item to the active array from the main queue
  async postProcess(processedItem) {
    // Remove the processed item from the active array
    log.info("RUNNING POST PROCESS FOR " + processedItem.url);
    let indexOfProcessedItem;

    if (processedItem.isRateLimited) {
      if (processedItem.retryAfter) {
        if (parseInt(processedItem.retryAfter) < 10000) {
          // Assume this is a number of seconds to delay the request by rather than a timestamp
          this.rateLimitTimer[processedItem.baseUrl] = parseInt(processedItem.retryAfter);
        } else {
          this.rateLimitTimer[processedItem.baseUrl] = Math.round((new Date(processedItem.retryAfter) - Date.now()) / 1000);
        }
      } else {
        // Set the backoff to ten seconds, and double it each time we keep getting HTTP 429s.
        this.rateLimitTimer[processedItem.baseUrl] = this.rateLimitTimer[processedItem.baseUrl] ? this.rateLimitTimer[processedItem.baseUrl] * 2 : 2;
        log.info(`[CQ:RL] Exponential backoff (${this.rateLimitTimer[processedItem.baseUrl]}s) active for ${processedItem.url}`);
      }

      this.schedule.addItem({
        runTime: Date.now() + (this.rateLimitTimer[processedItem.baseUrl] * 1000),
        run: () => {
          log.info(`[CQ:RL] Adding ${processedItem.url} to start of queue after ${this.rateLimitTimer[processedItem.baseUrl]}s`);
          this.addItemsToStart([processedItem.url]);
        }
      });
    }

    for (let i = 0; i < this.active.length; i++) {
      const activeItem = this.active[i];
      if (activeItem.url === processedItem.url) {
        indexOfProcessedItem = i;
        break;
      }
    }

    this.active.splice(indexOfProcessedItem, 1);

    // Add the processed item to the history
    this.history.push(processedItem);

    this.totalCrawled++;

    // Add next item to active queue
    if (this.isRunning) {
      try {
        await this.addActiveItem();
      } catch (e) {
        log.error(`[ERR] [${e.type}] ${e.message}`);
      }
    }

    if (this.active.length === 0) {
      log.info(`[CQ] Active queue is empty, ${this.history.length} items in history, ${this.queue.length} items in queue, ${this.cooldownCount} items in cooldown.`)
      this.isRunning = false;
    }
  }

  // Internal checking methods

  // Checks the number of times the baseUrl of item has been requested in the last n seconds where n == this.config.throttle.time
  checkBaseUrlReqCount(item) {
    let itemBaseUrl = item.match(this.baseUrlMatch);
    itemBaseUrl = itemBaseUrl ? itemBaseUrl[0] : null;

    // Get the items in the history and active arrays that have the same baseUrl as the item and that have been
    // requested recently (recent is defined as the throttle time in the config).
    let matchingBaseUrlsHistory = this.history.filter((historyItem) => {
      return historyItem.baseUrl === itemBaseUrl && (Date.now() - historyItem.requestTimeStamp) < this.config.throttle.time;
    });
    let matchingBaseUrlsActive = this.active.filter((activeItem) => { return activeItem.baseUrl === itemBaseUrl });

    return matchingBaseUrlsHistory.length + matchingBaseUrlsActive.length;
  }

  // Returns the number of requests made in last n seconds where n == this.config.throttle.time
  countRecentRequests() {

    let recentHistoryReqs = this.history.filter((historyItem) => { return (Date.now() - historyItem.requestTimeStamp) < this.config.throttle.time });
    let countActiveReqs = this.active.length;

    return recentHistoryReqs.length + countActiveReqs;
  }

  // Get either the newest or oldest item in the history and active queue by baseUrl
  // within the time threshold.
  // Provide full URL and optionally 'newest' or 'oldest' depending on which needed.
  getMostRecentItemByBaseURL(item, newestOrOldest = 'newest') {
    let baseUrl = item.match(this.baseUrlMatch);
    baseUrl = baseUrl ? baseUrl[0] : null;

    let matchingBaseUrlsHistory = this.history.filter((historyItem) => {
      return historyItem.baseUrl === baseUrl && (Date.now() - historyItem.requestTimeStamp) < this.config.throttle.time;
    }).sort((a, b) => {
      return newestOrOldest == 'newest' ? a.requestTimeStamp < b.requestTimeStamp : a.requestTimeStamp > b.requestTimeStamp;
    });
    let matchingBaseUrlsActive = this.active.filter((activeItem) => {
      return activeItem.baseUrl === baseUrl;
    }).sort((a, b) => {
      return newestOrOldest == 'newest' ? a.requestTimeStamp < b.requestTimeStamp : a.requestTimeStamp > b.requestTimeStamp;
    });

    let matchingBaseUrlHistory = matchingBaseUrlsHistory[0];
    let matchingBaseUrlHistoryTimestamp = matchingBaseUrlHistory && typeof matchingBaseUrlHistory == 'object' ? matchingBaseUrlHistory.requestTimeStamp : 0;

    let matchingBaseUrlActive = matchingBaseUrlsActive[0];
    let matchingBaseUrlActiveTimestamp = matchingBaseUrlActive && typeof matchingBaseUrlActive == 'object' ? matchingBaseUrlActive.requestTimeStamp : 0;

    // Find largest history or activeItem requestTimestamp and return it
    return matchingBaseUrlActiveTimestamp > matchingBaseUrlHistoryTimestamp ? matchingBaseUrlActive : matchingBaseUrlHistory;
  }

  // Queue manipulation methods

  // adds the next item in the queue to the active array. this automatically starts it being processed.
  async addActiveItem() {
    if (this.queue.length === 0) {
      throw { type: "QueueEmpty", message: 'Queue is empty.' };
    }

    const item = this.queue.shift();

    // Check if the item is already in the active array. If it is, just remove it from the queue.
    if (this.active.filter((activeItem) => { return activeItem.url === item }).length) {
      this.queue.shift();
      throw { type: "ItemExistsInActiveArray", message: 'Can\'t add item to the active array. This item already exists in the active array.' };
    }

    // Check if we would request this baseURL too many times by looking at the total number of base URLs that match the next item in the active array and the history.
    let recentReqsCountForBaseUrl = this.checkBaseUrlReqCount(item);

    // This base URL has been crawled too many times. Add it to the cooloff queue.
    if (recentReqsCountForBaseUrl >= this.config.throttle.perBaseURL) {
      // log.warn(`[CQ:RL] Can't add this item to the active queue, the base url (${item}) has been crawled too many times recently`);
      let mostRecentItemWithSameBaseUrl = this.getMostRecentItemByBaseURL(item, 'oldest');

      // Set the item to be executed in cooloffTimer ms.
      let cooloffTimer = (this.config.throttle.time + mostRecentItemWithSameBaseUrl.requestTimeStamp);
      // log.info(`[CQ:RL] Added ${item} to cooldown queue. Crawling in ${cooloffTimer}ms`);
      this.cooldownCount++;

      this.schedule.addItem({
        runTime: cooloffTimer,
        run: () => {
          log.info(`[CQ:RL] ${item} has now cooled down. Moving to the start of the crawl queue`);
          this.addItemsToStart([item]);
          this.cooldownCount--;
        }
      });

      // TODO: If we can't add this item to the start of the active queue, then see if we can add the
      // next item in the queue that has a different baseURL (as long as we haven't also hit the global req limit).
      // This will help performance. Especially if we want to keep lower per- baseURL limits.
      // Currently a bottleneck, we might have lots of other URLs we want to crawl, but we can't get to them
      // because we're waiting on some URLs which have already hit the limit.
      // if(recentReqsCount < this.config.throttle.maxRequests) { this.active.push(this.findNextNotWithBaseURL(mostRecentItemWithSameBaseUrl.baseUrl))}

      throw { type: "BaseURLLimit", message: "Can't add item to active array. This base URL has been crawled too many times recently. Moved this item to the cooloff queue." };
    }

    // Check how many requests we've made in the last n seconds where n == this.config.throttle.time
    let recentReqsCount = this.countRecentRequests();
    // log.info(`[CQ:REQ] Recent requests count: ${recentReqsCount}`);

    // If true, the limit for requests in this.config.throttle.time has been reached.
    if (recentReqsCount >= this.config.throttle.maxRequests) {

      if (this.isRunning) {
        this.stop();
        this.schedule.addItem({
          runTime: Date.now() + this.config.throttle.time,
          run: () => {
            if (!this.isRunning) {
              this.start();
            }
          }
        });

        log.warn(`[CQ:RL] Crawling will resume in ${this.config.throttle.time}ms...`)
      }

      throw { type: "ReqLimitReached", message: `Can't add this item (${item}), hit the maximum amount of requests allowed (${this.config.throttle.maxRequests}) in ${this.config.throttle.time}ms.` };
    }

    let baseUrl = item.match(this.baseUrlMatch);
    baseUrl = baseUrl ? baseUrl[0] : null;

    // Check the robots.txt file for the url (if available) to see if the request can be made
    if (baseUrl) {
      let robotsAllowed = await Request.areRobotsAllowed(baseUrl, item);
      if (!robotsAllowed) {
        this.queue.shift();
        throw { type: "RobotsDisallowed", message: `The remote server does not allow requests to this URL (${item}) according to their robots.txt file. This item has been removed from the queue.` };
      }
    } else {
      // No baseURL means that the item doesn't begin with http - we should skip it.
      throw { type: "BadURL", message: `The URL (${item}) does not match the baseURL pattern. Skipping this item.` };
    }

    // Checks have all been successful, we can add this item to the active array.
    // Start processing and add the next active item from the queue to the active array.
    const time = Date.now();

    this.active.push({
      url: item,
      baseUrl,
      requestTimeStamp: time,
      process: this.process({ iid: md5(time + item), url: item, baseUrl, requestTimeStamp: time })
    });

  }

  // Initialises the queue watcher. The queue watcher keeps track of the queue and processes items
  // if there is a period of inactivity.
  // Usually items are added to the active array after an item has finished processing in the postProcess
  // method. If there are no items in the queue at this time, the watcher will keep watch and add items
  // as they become available later on.
  initQueueWatcher() {
    return setInterval(async () => {
      if (!this.isRunning && this.queue.length && this.active.length !== this.config.maxParallelRequests && this.requestsAllowedBeforeLimit() > 0) {
        // log.info(`[CQ:WATCH] Queue watcher running, current queue length is ${this.queue.length}`);
        await this.start({ numOfItemsToAdd: Math.min(this.queue.length, this.requestsAllowedBeforeLimit()) });
      }
    }, 1000);
  }

  // Returns the amount of requests allowed before hitting the maxRequests limit set in config.
  // This is equal to 0 if limit has been reached. Shouldn't be negative, but not guaranteed.
  requestsAllowedBeforeLimit() {
    return this.config.throttle.maxRequests - this.countRecentRequests();
  }

  // adds an item to the end of the standard queue
  addItem(item) {
    if (this.queue.indexOf(item) === -1) {
      this.queue.push(item);
    }
  }

  // add an array of items to the end of the queue. checks if it is already in the queue.
  addItems(items) {
    const existingURLs = this.queue;
    this.queue = this.queue.concat(items.filter((item) => {
      // if (existingURLs.indexOf(item) !== -1) { log.warn(`[CQ] Not adding ${item} as it's already in the crawl queue.`); }
      return existingURLs.indexOf(item) === -1;
    }));

    return this.queue.length;
  }

  // Add an array of items to the start of the queue
  addItemsToStart(items) {
    const newURLs = items;

    this.queue = items.concat(this.queue.filter((queueItem) => {
      if (newURLs.indexOf(queueItem) !== -1) { log.warn(`[CQ] Not adding ${queueItem} as it's already in the crawl queue.`); }
      return newURLs.indexOf(queueItem) === -1;
    }));
  }

  remove(index) { } // remove an item from the crawl queue by index
  removeByUrl(url) { } // remove an item from the crawl queue by url

  // Cleans up old crawl history stored in this.history.
  initHistoryCleaner() {
    return setInterval(() => {
      if (this.history.length > this.config.historyLength) {
        log.info(`[CQ:HIST] Cleaning up crawl history as it's above the history limit (${this.history.length}/${this.config.historyLength}).`);
        this.history.splice(this.config.historyLength);
      }
    }, 1000);
  }

  // Saves the current active and main queue to file, called when app is closed - ok to be sync.
  save() {
    const queueData = {
      main: JSON.stringify(this.queue),
      active: JSON.stringify(this.active)
    };

    fs.writeFileSync(`queuedata.json`, JSON.stringify(queueData));
  }

  // Needs to be synchronous, as called in the constructor
  load() {
    const fileData = JSON.parse(fs.readFileSync('queuedata.json'));
    this.queue.push(JSON.parse(fileData.main));
    this.addItemsToStart(JSON.parse(fileData.active));
  }

  // Config methods
  get config() { return this._config; } // Gets the current config
  set config(newConfig) { this._config = newConfig; }

  resetConfig() {
    this.config(this.defaultConfig);
  }

  // Returns a sensible default config
  get defaultConfig() {
    return {
      maxParallelRequests: 5,
      throttle: { // allows max 50 requests, max 3 per baseURL over a rolling 60 second window
        maxRequests: 50, // should be more than maxParallelRequests
        perBaseURL: 3,
        time: 20 * 1000 // * 1000 for milliseconds
      },
      historyLength: 500, // number of requests to keep in the history
      recrawlInterval: 300 * 1000 // 5 minutes in ms
    }
  }
}

module.exports = CrawlQueue;