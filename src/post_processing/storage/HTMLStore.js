// Responsible for saving a completed, post processed HTML response to the database.
const log = require('../../../lib/log');

module.exports = async function (opts) {
  // console.log("HTML Store", processedItem.url, accumulatedPPObj, matchedRule);
  let { db, processedItem, accumulatedPPObj, matchedRule, crawlQueue } = opts;

  if (!processedItem.response) {
    return accumulatedPPObj;
  }

  log.info(`[PP:HTMLStore] [IID: ${processedItem.iid}] [URL: ${processedItem.url}] Starting HTMLStore post processer...`);

  const formattedDBObj = {
    iid: processedItem.iid,
    url: processedItem.url,
    title: accumulatedPPObj.title,
    page_text: accumulatedPPObj.pageText,
    page_html: accumulatedPPObj.html,
    structured_content: JSON.stringify(accumulatedPPObj.structuredContent),
    retrieved: new Date()
  };

  try {
    // Insert page HTML into database
    log.info(`[PP:HTMLStore] [IID: ${processedItem.iid}] [URL: ${processedItem.url}] Inserting page into database...`);
    const pageQuery = await db.queryPromise("INSERT INTO crawled_pages SET ?", formattedDBObj);
    const pageRowID = pageQuery.result.insertId;
    accumulatedPPObj.crawled_page_id = pageRowID;
    log.info(`[PP:HTMLStore] [IID: ${processedItem.iid}] [URL: ${processedItem.url}] Inserted page into database`);

    // Insert links into link table (if specified in crawl rule)
    // NOTE: This is probably bad for performance, and we're not doing anything with these links
    // so it's disabled for now.
    // if (matchedRule.linkDiscovery && matchedRule.linkDiscovery.enabled) {
    //   accumulatedPPObj.links.forEach((link) => {
    //     db.queryPromise("INSERT INTO crawled_links SET ?", {
    //       crawled_page_id: pageRowID,
    //       url: link
    //     });
    //   });
    // }

    // Insert media into media table (if specified in crawl rule)
    // Note: images only for now
    if (matchedRule.media && matchedRule.media.enabled) {
      log.info(`[PP:HTMLStore] [IID: ${processedItem.iid}] [URL: ${processedItem.url}] Inserting media elements into database...`);
      accumulatedPPObj.media.images.forEach((imageUrl) => {
        db.queryPromise("INSERT INTO crawled_files SET ?", {
          crawled_page_id: pageRowID,
          url: imageUrl
        });
      });
    }
    log.info(`[PP:HTMLStore] [IID: ${processedItem.iid}] [URL: ${processedItem.url}] Inserted media elements into database`);
  } catch (e) {
    log.error(`[PP:HTML] [IID: ${processedItem.iid}] [URL: ${processedItem.url}] Error saving HTML page to database: `, e.code, e.sqlMessage);
  }

  log.info(`[PP:HTMLStore] [IID: ${processedItem.iid}] [URL: ${processedItem.url}] Finished HTMLStore post processer`);

  return accumulatedPPObj;
}