const mysql = require('mysql2');
require("dotenv").config();

const dbConnection = mysql.createConnection({
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
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

module.exports = dbConnection;