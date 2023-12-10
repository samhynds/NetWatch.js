// Don't really need to do any parsing. This is just for files to download and store.
// Pass the file data on to the next step in Post Processing.
module.exports = function (opts) {
  let { db, processedItem, accumulatedPPObj, matchedRule, crawlQueue } = opts;
  return accumulatedPPObj;
}