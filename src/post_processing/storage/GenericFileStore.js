const fs = require('fs');
const md5 = require('md5');
const log = require('../../../lib/log');
require("dotenv").config();

module.exports = async function (opts) {
  let { db, processedItem, accumulatedPPObj, matchedRule, crawlQueue } = opts;

  if (!processedItem.response) {
    return accumulatedPPObj;
  }

  accumulatedPPObj.responseData = await processedItem.response.text();

  // The file should already exist in the crawled_files table from when we first discovered it.
  // Look it up by URL and modify it after the file has been saved to the file system.

  if (processedItem.response && processedItem.response.ok() && accumulatedPPObj.responseData) {
    const ext = processedItem.url.replace(/\?(.*)$/, '').split('.').pop();
    const fileName = `${md5(processedItem.url + Math.random())}-${Date.now()}.${ext}`;
    const filePath = `${process.env.DATA_DIR}/${fileName}`;

    const responseBuffer = Buffer.from(accumulatedPPObj.responseData);

    fs.writeFile(filePath, responseBuffer, { encoding: null }, async (err) => {
      if (err) log.error(err);
      await db.queryPromise("UPDATE crawled_files SET ? WHERE url = ?", [{
        location: filePath,
        filetype: processedItem.response.headers['content-type'],
        retrieved: new Date(),
        hash: md5(responseBuffer.toString())
      }, processedItem.url]);
    })
  } else {
    log.error(`[PP:GFILE] Error with the response for ${processedItem.url}`);
  }

  return accumulatedPPObj;
}