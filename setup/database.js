/*
    Connects to the database specified in the .env file and creates all
    the necessary databases and tables.
*/

require("dotenv").config();
const mysql = require('mysql2');
const log = require("../lib/log");

const dbConnection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  charset: "utf8mb4" // Gotta save them emojis
});

dbConnection.connect();

dbConnection.queryPromise = (sql, values) => {
  return new Promise((resolve, reject) => {
    dbConnection.query(sql, values, (err, result, fields) => {
      if (err) reject(err);
      resolve({ result, fields });
    });
  });
}


(async () => {

  try {
    // Create the database
    await dbConnection.queryPromise("CREATE DATABASE IF NOT EXISTS ??", [process.env.DB_DATABASE]);
    log.success(`[DB:SETUP] Created database ${process.env.DB_DATABASE}`);

    // Create the tables
    await dbConnection.queryPromise(`
      CREATE TABLE IF NOT EXISTS \`${process.env.DB_DATABASE}\`.\`crawled_pages\` (
        \`id\` int(11) NOT NULL AUTO_INCREMENT,
        \`iid\` varchar(128) DEFAULT NULL,
        \`url\` varchar(2048) NOT NULL,
        \`title\` varchar(256) DEFAULT NULL,
        \`page_text\` mediumtext CHARACTER SET utf8mb4,
        \`page_html\` mediumtext CHARACTER SET utf8mb4,
        \`structured_content\` json DEFAULT NULL,
        \`retrieved\` datetime DEFAULT NULL,
        \`saved\` datetime DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=latin1
      `);
    log.success(`[DB:SETUP] Created table ${process.env.DB_DATABASE}.crawled_pages`);

    await dbConnection.queryPromise(`
      CREATE TABLE IF NOT EXISTS \`${process.env.DB_DATABASE}\`.\`crawled_files\` (
        \`id\` int(11) NOT NULL AUTO_INCREMENT,
        \`crawled_page_id\` int(11) DEFAULT NULL,
        \`retrieved\` datetime DEFAULT NULL,
        \`filetype\` varchar(64) DEFAULT NULL,
        \`location\` varchar(256) DEFAULT NULL,
        \`url\` varchar(2048) DEFAULT NULL,
        \`hash\` varchar(128) DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`fk_file_to_page\` (\`crawled_page_id\`),
        CONSTRAINT \`fk_file_to_page\` FOREIGN KEY (\`crawled_page_id\`) REFERENCES \`crawled_pages\` (\`id\`)
      ) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=latin1
      `);
    log.success(`[DB:SETUP] Created table ${process.env.DB_DATABASE}.crawled_files`);

    await dbConnection.queryPromise(`
      CREATE TABLE IF NOT EXISTS \`${process.env.DB_DATABASE}\`.\`crawled_links\` (
        \`id\` int(11) NOT NULL AUTO_INCREMENT,
        \`crawled_page_id\` int(11) NOT NULL,
        \`url\` varchar(2048) NOT NULL,
        \`text\` varchar(256) DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`fk_link_to_page\` (\`crawled_page_id\`),
        CONSTRAINT \`fk_link_to_page\` FOREIGN KEY (\`crawled_page_id\`) REFERENCES \`crawled_pages\` (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=latin1
      `);
    log.success(`[DB:SETUP] Created table ${process.env.DB_DATABASE}.crawled_links`);

    await dbConnection.queryPromise(`
      CREATE TABLE IF NOT EXISTS \`${process.env.DB_DATABASE}\`.\`robots_txt\` (
        \`id\` int(11) NOT NULL AUTO_INCREMENT,
        \`baseurl\` varchar(256) NOT NULL,
        \`content\` text,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=latin1
      `);
    log.success(`[DB:SETUP] Created table ${process.env.DB_DATABASE}.robots_txt`);

    log.success(`[DB:SETUP] Done!`);
    process.exit();

  } catch (e) {
    log.error(`[DB:SETUP] There was a problem with a database command. `, e);
    process.exit();
  }

})();
