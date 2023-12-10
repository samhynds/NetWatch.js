const db = require("./Database");
const log = require('../lib/log');
const axios = require("axios");
// const puppeteer = require("puppeteer");

// TODO: Make this configurable with env
const NW_USER_AGENT = "Mozilla/5.0 (compatible; NetWatch/1.0)";

class Request {
  constructor(opts) {
    this.followRedirects = opts.followRedirects;
    this.internalRedirectsOnly = opts.internalRedirectsOnly;
    // return (async () => {
    //   this.browser = await puppeteer.launch({
    //     headless: true,
    //     defaultViewport: {
    //       width: 1440,
    //       height: 900
    //     },
    //     timeout: 10000
    //   });
    //   return this;
    // })();
  }

  // returns https://pptr.dev/#?product=Puppeteer&version=v1.12.1&show=api-class-response
  async get(opts) {
    const page = await this.browser.newPage();
    // await page.setUserAgent(NW_USER_AGENT);
    await page.setJavaScriptEnabled(true);
    const response = await page.goto(opts.url, { waitUntil: 'domcontentloaded' });

    return { page, response };
  }

  async getAxios(opts) {
    if (opts.url.indexOf("http") !== 0) {
      throw { type: "BadURL", message: 'URL provided does not start with "http".' };
    }

    const response = await axios.get(opts.url, {
      responseType: opts.responseType || 'arraybuffer',
      headers: {
        'user-agent': NW_USER_AGENT
      },
      timeout: 10000,
      maxRedirects: this.followRedirects ? 5 : 0,
      maxContentLength: 5242880 // 5MB
    });

    // Check if the URL we've been redirected to is on the same domain
    // as the initial request URL we provided.
    if (this.internalRedirectsOnly) {
      if (!response.request.res.responseUrl.startsWith(opts.baseUrl)) {
        throw { type: 'BadRedirect', message: "Request would have redirected to an external URL and internalRedirectsOnly is true. Cancelling request." }
      }
    }

    return {
      response: {
        text: function () { return response.data },
        headers: function () { return response.headers },
        ok: function () { return true }
      },

      page: {
        close: function () { return true }
      }
    }
  }


  /**
   * Checks the robots.txt for a url to see if a request is allowed to that url.
   *
   * @static
   * @param {string} baseUrl
   * @memberof Request
   * @returns {Boolean}
   */
  static async areRobotsAllowed(baseUrl, fullUrl) {
    log.info(`[REQ] Checking if robots are allowed on ${fullUrl}`);
    // Check if we have a copy of the robots.txt for the domain/baseurl for the upcoming request.
    const dbResult = await db.queryPromise("SELECT content FROM robots_txt WHERE baseurl = ?", [baseUrl]);
    let robotsTxt = '';

    if (dbResult.result && dbResult.result.length) {
      log.info(`[REQ] Robots.txt entry found in database for ${fullUrl}`);
      robotsTxt = dbResult.result[0].content;
    } else {
      // No robots.txt found for this baseurl - make a request
      try {
        const robotsResponse = await Request.get({ url: `${baseUrl}/robots.txt`, responseType: 'text' });
        log.info(`[REQ] Robots.txt response from server for ${fullUrl}`);
        robotsTxt = robotsResponse.data;

        try {
          log.info(`[REQ] Inserting robots.txt entry into DB for ${fullUrl}`);
          await db.queryPromise("INSERT INTO robots_txt SET ?", {
            baseurl: baseUrl,
            content: robotsTxt
          });
        } catch (e) {
          log.error(`[REQ:ROBOTS] Error saving robots.txt entry into database.`, e)
          debugger;
        }

      } catch (e) {
        // No robots.txt available on the remote server either - assume crawling is allowed.
        try {
          log.info(`[REQ] Inserting empty robots.txt entry into DB for ${fullUrl}`);
          await db.queryPromise("INSERT INTO robots_txt SET ?", {
            baseurl: baseUrl
          });
        } catch (e) {
          log.error(`[REQ:ROBOTS] Error saving robots.txt entry into database.`, e)
          debugger;
        }
      }
    }

    const matchedRobotsRules = Request.parseRobotsTxt(robotsTxt, baseUrl, fullUrl);

    if (!matchedRobotsRules.length) {
      return true;
    } else {
      return false;
    }
  }

  static parseRobotsTxt(robotsTxt, baseUrl, fullUrl) {
    if (!robotsTxt || typeof robotsTxt !== 'string') return []; // Empty robots.txt has probably been inserted automatically - allow crawling.
    const rules = robotsTxt.split(/\n\n/g);

    // Check each rule to see if there's a matching user agent string or *
    return rules.filter((ruleString) => {
      // Firstly, work out if the UA specified matches NetWatches UA
      const userAgent = ruleString.split(/^User\-agent: ?(.*)$/gim)[1];
      if (userAgent && (userAgent === '*' || new RegExp(userAgent.toString()).test(NW_USER_AGENT))) {
        return ruleString;
      } else {
        return false;
      }
    }).filter((matchedRule) => {
      // Here, all rules apply to NetWatch, now just work out if they apply to the current URL too.
      const urlPath = matchedRule.split(/^Disallow: ?(.*)$/gim)[1];
      if (urlPath && urlPath.length > 1) {
        return fullUrl.indexOf(urlPath) > -1;
      } else {
        return false;
      }
    })
  }

}

module.exports = Request;