const log = require('../../lib/log');

// Responsible for matching a processedItem to a crawl rule from a crawl rule file.
module.exports = class CrawlRuleMatcher {

  constructor(crawlRuleFile) {
    this.crawlRuleFile = crawlRuleFile;
  }

  /**
   * Finds all the matched rules in the crawl rule file for a provided "processedItem".
   * Matches by the URL.
   *
   * @param {*} processedItem
   */
  findRules(processedItem) {
    const url = processedItem.url;
    const rules = this.crawlRuleFile.rulesets;

    // loop over the rules in the file. find the most specific match
    return rules.filter((rule) => {
      return rule.pattern.test(url);
    });
  }

  findMostSpecificRule(processedItem) {
    return this.findRules(processedItem).sort((a, b) => {
      return b.pattern.toString().length - a.pattern.toString().length;
    })[0];
  }

  // loads a default crawl rule for an item, used as a fallback if there is none
  // found in the crawl rule file. This could be different depending on the
  // processedItem if needed. Assuming an HTML page here.
  loadDefault(processedItem) {
    return {
      linkDiscovery: {
        enabled: true, // Should links be extracted from the page?
        targeted: false, // true == find links using the selectors array, false == get all links on page
        selectors: [],
        internalOnly: true,
        crawlDiscovered: true // Links that are discovered are added to the crawl queue
      },
      recrawl: false,
      media: {
        enabled: true, // Should media URLs be extracted from the page?
        crawl: false
      },
      structuredContent: {},
      followRedirects: false,
      checkDatabase: true
    }
  }
} 