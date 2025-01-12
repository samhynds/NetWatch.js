> [!IMPORTANT]
> NetWatch.js has been superseded by [netwatch](https://github.com/samhynds/netwatch) and is no longer being maintained

# NetWatch

NetWatch is a general web crawler. It works by using a crawl rule file, which specifies which pages the crawler should initially request, and how it should handle repsonses to different pages. NetWatch also utilises a modular post processing system which can dynamically load and process responses depending on the mime type of the response received. It currently has built-in post processing modules for parsing and storing HTML and for saving generic blob files (images, videos, etc). NetWatch also respects specified rate limits and robots.txt files.

## Quick Start

### Running with Docker Compose

NetWatch is setup to run with Docker Compose. Firstly, modify the environment variables in `docker-compose.yml` and create an `.env` file from `.env-sample`. Then run `docker compose up` to start up the application, a database, and a RabbitMQ server.

The local directory `./db_data` is used as a Docker volume to store the MySQL data and this directory is copied into the application container at build time. RabbitMQ data is not persisted after container restarts.

You can view your database data with your client of choice, by default the MySQL container is listening on port 3307.

You can view the RabbitMQ queue information by logging into the management UI. This is listening on port 15672.

### Running Stand-alone

If you wish to run NetWatch outside of a container, follow the instructions below. You'll need a MySQL database and a RabbitMQ instance running.

1. Copy the `.env-sample` file to `.env` and modify `.env` to contain your desired values.
2. Run `node setup/database.js` to create the database and tables.
3. Create or use a pre-made crawl rule file, and modify the `crawlRuleset` variable in `app.js` to use it. See the [crawl rule section](#crawl-rule-files) to see how to create one.
4. If necessary, create some post processing files which will process the responses. There are currently post processing files for HTML and for downloading blob files. If you need to handle different file types, read the [post processing section](#post-processing) below.
5. Start the application using `npm run start`.

## Puppeteer

There are some test puppeteer bits in this repo, but it's a big install so I've removed it from package.json. You'll need to npm install it before using these bits.

## Crawl Rule files

A CrawlRule file is a JSON file which is loaded into NetWatch when it’s first started. This file specifies the rules for NetWatch to follow when crawling.

CrawlRule files contain a list of initial URLs. These URLs are added to the CrawlQueue and are crawled first when the queue is started - usually when NetWatch is started.

Rulesets are specified in the CrawlRule file. A ruleset describes how NetWatch should handle pages that have responded to our requests.

The config property in the CrawlRule file specifies global config options such as the recrawl interval.

See [crawl_rules/news.js](crawl_rules/news.js) for an example of a crawl rule file.

## Post Processing

Post processing modules are loaded depending on the Content Type which is returned from the response of a request. These definitions are contained in src/post_processing/PostProcessingDefaults.js and can be overridden by a crawl rule.

Ensure that each of the post processor functions defined in the functions array actually exist. These functions are run in the order defined in that array and information is passed from one to the next one.

Post processor functions should be defined in the same pattern - use the existing ones as templates. Generally, the information is modified and retrieved in the object `accumulatedPPObj`.

## Requirements

- Docker Compose

  _or_

- NodeJS 16.17.x
- MySQL 8
- RabbitMQ 3.11.2
