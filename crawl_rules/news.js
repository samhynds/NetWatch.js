module.exports = {
  // Crawl these pages first when the application starts up
  initialURLs: [
    "https://www.bbc.co.uk/news",
    "https://www.theguardian.com/uk",
    "https://news.sky.com/",
    "https://www.politico.eu/?no-geo-redirect",
    "https://apnews.com/",
    "https://www.dw.com/en/"
  ],

  rulesets: [
    { // BBC News home page - find links to articles
      pattern: /^https?\:\/\/www\.bbc\.co\.uk\/news$/i,
      linkDiscovery: {
        enabled: true, // Save links in the database
        crawlDiscovered: true, // And add those links to the crawl queue
        internalOnly: true, // Only save & crawl links that have the same base URL as the page they were found on
        pattern: /^https?\:\/\/www\.bbc\.co\.uk\/news\/([a-z][a-z0-9]*)(-[a-z0-9]+)*\d+$/i // Only look for links with this pattern
      },
      media: {
        enabled: false // Don't extract any images from the page
      },
      recrawl: true // Re-crawl this page after recrawlInterval (see the bottom of this file)
    },
    { // BBC article pages
      pattern: /^https?\:\/\/www\.bbc\.co\.uk\/news\/([a-z][a-z0-9]*)(-[a-z0-9]+)*\d+$/i, // This matches the pages for the links found on the ruleset above in linkDiscovery.pattern (i.e. news pages)
      linkDiscovery: {
        enabled: false // Don't save links from these pages
      },
      media: {
        enabled: false // Don't extract any images from the page
      },
      recrawl: false, // Don't re-crawl this page
      structuredContent: { // Structured content is saved in the database. The row for this entry will contain a JSON datastructure with "title" and "body" properties, and the values will be set by extracting content from the DOM selectors on the page below.
        title: {
          type: "string",
          selector: "h1#main-heading"
        },
        body: {
          type: "string",
          selector: "#main-content article"
        }
      }
    },
    { // Guardian home page - find links to articles
      pattern: /^https?\:\/\/www\.theguardian\.com\/uk$/i,
      linkDiscovery: {
        enabled: true,
        crawlDiscovered: true,
        internalOnly: true,
        pattern: /^https?\:\/\/www\.theguardian\.com\/[\w+\d+\-]+\/\d{4}\/\w{3}\/\d{2}\/([a-z][a-z0-9]*)(-[a-z0-9]+)+$/i // /category/live (optional)/year/month/day/title
      },
      media: {
        enabled: false
      },
      recrawl: true
    },
    { // Guardian article pages
      pattern: /^https?\:\/\/www\.theguardian\.com\/[\w+\d+\-]+\/\d{4}\/\w{3}\/\d{2}\/([a-z][a-z0-9]*)(-[a-z0-9]+)+$/i,
      linkDiscovery: {
        enabled: false
      },
      media: {
        enabled: false
      },
      recrawl: false,
      structuredContent: {
        title: {
          type: "string",
          selector: "article h1"
        },
        body: {
          type: "string",
          selector: "article div[data-gu-name='body']"
        }
      }
    },
    { // Sky News home page - find links to articles
      pattern: /^https?\:\/\/news\.sky\.com\/?$/i,
      linkDiscovery: {
        enabled: true,
        crawlDiscovered: true,
        internalOnly: true,
        pattern: /^https?\:\/\/news\.sky\.com\/story\/([a-z][a-z0-9]*)(-[a-z0-9]+)*\d+$/i
      },
      media: {
        enabled: false
      },
      recrawl: true
    },
    { // Sky News article pages
      pattern: /^https?\:\/\/news\.sky\.com\/story\/([a-z][a-z0-9]*)(-[a-z0-9]+)*\d+$/i,
      linkDiscovery: {
        enabled: false
      },
      media: {
        enabled: false
      },
      recrawl: false,
      structuredContent: {
        title: {
          type: "string",
          selector: ".sdc-article-header__title"
        },
        body: {
          type: "string",
          selector: ".sdc-article-body"
        }
      }
    },
    { // Politico home page - find links to articles
      pattern: /^https?\:\/\/www\.politico\.eu\/?(\?no-geo-redirect)?$/i,
      linkDiscovery: {
        enabled: true,
        crawlDiscovered: true,
        internalOnly: true,
        pattern: /^https?\:\/\/www\.politico\.eu\/(article|news)\/([A-Z][a-z0-9]*)(-[a-z0-9]+)*\/?$/i
      },
      media: {
        enabled: false
      },
      recrawl: true
    },
    { // Politico article pages
      pattern: /^https?\:\/\/www\.politico\.eu\/article\/([A-Z][a-z0-9]*)(-[a-z0-9]+)*\/?$/i,
      linkDiscovery: {
        enabled: false
      },
      media: {
        enabled: false
      },
      recrawl: false,
      structuredContent: {
        title: {
          type: "string",
          selector: "h1.article-meta__title"
        },
        body: {
          type: "string",
          selector: ".article__content"
        }
      }
    },
    { // AP home page - find links to articles
      pattern: /^https?\:\/\/apnews\.com\/?$/i,
      linkDiscovery: {
        enabled: true,
        crawlDiscovered: true,
        internalOnly: true,
        pattern: /^https?\:\/\/apnews\.com\/article\/([a-z][a-z0-9]*)(-[a-z0-9]+)*$/i
      },
      media: {
        enabled: false
      },
      recrawl: true
    },
    { // AP articles
      pattern: /^https?\:\/\/apnews\.com\/article\/([a-z][a-z0-9]*)(-[a-z0-9]+)*$/i,
      linkDiscovery: {
        enabled: false
      },
      media: {
        enabled: false
      },
      recrawl: false,
      structuredContent: {
        title: {
          type: "string",
          selector: ".Body .Content h1"
        },
        body: {
          type: "string",
          selector: ".Body .Content .Article"
        }
      }
    },
    { // DW home page - find links to articles
      pattern: /^https?\:\/\/www\.dw\.com\/en\/?(top-stories.*)?$/i,
      linkDiscovery: {
        enabled: true,
        crawlDiscovered: true,
        internalOnly: true,
        pattern: /^https?\:\/\/www\.dw\.com\/en\/([a-z][a-z0-9]*)(-[a-z0-9]+)*\/a-\d+\/?$/i
      },
      media: {
        enabled: false
      },
      recrawl: true
    },
    { // DW articles
      pattern: /^https?\:\/\/www\.dw\.com\/en\/([a-z][a-z0-9]*)(-[a-z0-9]+)*\/a-\d+\/?$/i,
      linkDiscovery: {
        enabled: false
      },
      media: {
        enabled: false
      },
      recrawl: false,
      structuredContent: {
        title: {
          type: "string",
          selector: "body article:first-child h1"
        },
        body: {
          type: "string",
          selector: "body article:first-child"
        }
      }
    }
  ],

  config: {
    maxParallelRequests: 5,
    throttle: { // allows max 100 requests, max 5 per baseURL over a rolling 60 second window
      maxRequests: 50, // should be more than maxParallelRequests
      perBaseURL: 5,
      time: 60 * 1000 // * 1000 for milliseconds
    },
    historyLength: 50, // number of requests to keep in the history
    recrawlInterval: 15 * 60 * 1000, // 15 mins
    followRedirects: true,
    internalRedirectsOnly: true, // only allow internal redirects (within the same domain)
    checkDatabase: true // Check if each item has already been crawled and saved in the db before crawling it. If it has, skip it.
  }
};