// Parses HTML. First function run in the post processing chain for HTML pages.
// accumulatedPPObj is expected to be undefined at this point.

const log = require('../../../lib/log');
const cheerio = require('cheerio');

module.exports = async function (opts) {
  let { db, processedItem, accumulatedPPObj, matchedRule, crawlQueue } = opts;

  if (!processedItem.response) {
    return accumulatedPPObj;
  }

  log.info(`[PP:HTMLPARSER] [IID: ${processedItem.iid}] [URL: ${processedItem.url}] Starting HTMLParser post processer...`);

  // Don't save the full HTML for each page, it takes up too much space
  // accumulatedPPObj.html = await processedItem.response.text();

  const pageHtml = await processedItem.response.text();
  const $ = cheerio.load(pageHtml);

  await processedItem.page.close();

  // Convert NodeList to an array of strings of href attribute values.
  // Also convert relative links to absolute ones, deduplicates and removes #links.
  // Filters links by regex pattern, if specified in crawl rule.
  async function getLinks(selector, internalOnly, pattern) {
    const linkEls = $(selector);
    let hrefsObj = {};
    let hrefs = [];

    if (!internalOnly) debugger;

    // filter function
    const filterFunc = async href => {
      let shouldReturnLink = false;

      if (internalOnly) {
        shouldReturnLink = (href.indexOf('/') === 0 || href.startsWith(processedItem.baseUrl)) && href.indexOf('#') === -1;
      } else {
        shouldReturnLink = href.indexOf('#') === -1 && href.indexOf('http') === 0;
      }

      // Check if link has been crawled recently
      const matchesInHistory = crawlQueue.history.filter((historyItem) => {
        return historyItem.url === href;
      });

      if (matchesInHistory.length) {
        shouldReturnLink = false;
      } else if (shouldReturnLink && crawlQueue.config.checkDatabase) {
        // URL is not in crawlQueue.history in-memory, now check the database for
        // a recent crawl of this URL. Recent is set in config, see TODO at top of file.

        // this may not differentiate between relative and absolute links, so this may accidentally let you recrawl a page that's been
        // crawled before
        const matchingInDB = await db.queryPromise("SELECT url, retrieved from crawled_pages WHERE url = ? order by retrieved desc", [href]);
        if (matchingInDB.result && matchingInDB.result.length) {
          log.warn(`[PP:LINKS] Not adding ${href} as it was found in the database and last crawled at ${matchingInDB.result[0].retrieved}.`)
          shouldReturnLink = false;
        }
      }

      return Promise.resolve(pattern ? shouldReturnLink && pattern.test(href) : shouldReturnLink);
    }

    // Create array of href strings. NOTE THIS IS CHEERIO/JQUERY.MAP NOT ARRAY.MAP!
    linkEls.map((linkEl) => {
      let href = $(linkEls[linkEl]).attr('href');
      if (href && typeof href === 'string') {

        // Any modifications to the href need to be done here
        href = href.replace(/\#(.*)$/i, '');

        hrefs.push((href && href.indexOf('/') === 0) ? processedItem.baseUrl + href : href);
      }
    });

    // Remove #links, mailto, loop over array and create object for deduplication purposes
    // Don't return links that have been crawled recently and are in the crawlQueue history array.
    const shouldExtractLinks = await Promise.all(hrefs.map(href => filterFunc(href)));

    shouldExtractLinks.forEach((shouldExtract, i) => {
      const href = hrefs[i];
      if (shouldExtract) hrefsObj[href.toString()] = 1;
    });

    return Object.keys(hrefsObj);
  }

  if (!matchedRule || !processedItem || !processedItem.response || !pageHtml) {
    log.error(`[PP:HTML] No matched rule or processed item.`);
    throw { 'code': "ERR_PP_NO_MATCHED_RULE_OR_ITEM" };
  }

  // Link Discovery
  let links = [];

  if (matchedRule.linkDiscovery && matchedRule.linkDiscovery.enabled) {
    if (matchedRule.linkDiscovery.targeted) {
      if (!matchedRule.linkDiscovery.selectors) {
        log.error(`[PP:HTML] Link targeting enabled, but no selectors specified.`);
        throw { 'code': "ERR_PP_NO_MATCHED_RULE_OR_ITEM" };
      } else {
        matchedRule.linkDiscovery.selectors.forEach(async selector => {
          links.push(await getLinks(selector, matchedRule.linkDiscovery.internalOnly, matchedRule.linkDiscovery.pattern));
        });
      }
    } else {
      links.push(await getLinks('a[href]', matchedRule.linkDiscovery.internalOnly, matchedRule.linkDiscovery.pattern));
    }
  }

  accumulatedPPObj.links = links.flat();

  log.info(`[PP:HTML] Found ${accumulatedPPObj.links.length} links:`, accumulatedPPObj.links);


  // Add links to the crawl queue, if specified in the crawl rule.
  if (matchedRule.linkDiscovery && matchedRule.linkDiscovery.crawlDiscovered) {
    log.info(`[PP:HTML] Adding ${accumulatedPPObj.links.length} links to the crawl queue from ${processedItem.url}.`);
    crawlQueue.addItems(accumulatedPPObj.links);
  }

  // Add the current page (processedItem) to the recrawl queue, if specified in the crawl rule.
  if (matchedRule.recrawl) {
    log.info(`[PP:HTML] Adding ${processedItem.url} to the recrawl queue.`, crawlQueue.recrawlQueue);
    crawlQueue.addUrlToRecrawler(processedItem.url);
  }

  let media = {};

  // Media (image) extraction
  if (matchedRule.media && matchedRule.media.enabled) {
    log.info(`[PP:HTML] Extracting media elements for ${processedItem.url}`);
    let selector = 'img[src]';

    if (matchedRule.media.targeted && matchedRule.media.selectors) {
      selector = matchedRule.media.selectors.join(', ');
      log.info(`[PP:HTML] Targeted media: looking for ${selector}`);
    }

    if (matchedRule.media.customFunction) {
      media.images = matchedRule.media.customFunction($);
    } else {
      let imgUrls = {};
      $(selector).each((i, el) => {
        let src = $(el).attr('src');
        if (src.indexOf('//') === 0) {
          src = "http:" + src;
        } else if (src.indexOf('/') === 0) {
          src = processedItem.baseUrl + src;
        }
        imgUrls[src] = 1;
      });
      media.images = Object.keys(imgUrls);
    }

    if (matchedRule.media.crawl) {
      // Add to start so that media assets aren't downloaded sometime in the distant future after
      // the HTML page they were discovered in.
      log.info(`[PP:MEDIA] Adding images to the start of the crawl queue...`);
      crawlQueue.addItemsToStart(media.images);
    }
  }

  accumulatedPPObj.media = media;

  let structuredContent = {};

  log.info(`[PP:STRUCTURED_CONTENT] Starting structured content extraction...`);

  // Structured content extraction and formatting
  for (let structuredContentName in matchedRule.structuredContent) {
    const structuredContentItem = matchedRule.structuredContent[structuredContentName];

    if (!structuredContentItem || structuredContentItem.type === 'html') {
      let structuredContentValue = [];

      $(structuredContentItem.selector).each((i, el) => {
        // Cheerio trick for getting outerHTML, see https://github.com/cheeriojs/cheerio/issues/54
        structuredContentValue.push($.html($(el)));
      });

      structuredContent[structuredContentName] = structuredContentValue;
    }

    else if (structuredContentItem.type === 'string') {
      let structuredContentValue = [];

      // TODO: this also gets text from inside child <script> tags which we don't want
      $(structuredContentItem.selector).each((i, el) => {
        let text = $(el).text().trim().replace(/(\n|\r|\t|\s{2})/g, '');
        structuredContentValue.push(text);
      });

      structuredContent[structuredContentName] = structuredContentValue;
    }

    else if (structuredContentItem.type === 'custom') {
      structuredContent[structuredContentName] = structuredContentItem.customFunction($);
    }
  }

  log.info(`[PP:STRUCTURED_CONTENT] Finished structured content extraction...`);

  accumulatedPPObj.structuredContent = structuredContent;

  accumulatedPPObj.title = $('title').text().slice(0, 256);

  // Don't save the full text for each page, it takes up too much space
  // accumulatedPPObj.pageText = $('html').text().replace(/\s+/gm, ' ');

  log.info(`[PP:HTMLPARSER] [IID: ${processedItem.iid}] [URL: ${processedItem.url}] Finished HTMLParser post processer...`);

  return accumulatedPPObj;
}

