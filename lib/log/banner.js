var package = require("../../package.json");
var log = require("./index");
var colors = require('colors');
require("dotenv").config();

var banner = [];
banner.push(`█▄░█ █▀▀ ▀█▀ █░█░█ ▄▀█ ▀█▀ █▀▀ █░█
                          █░▀█ ██▄ ░█░ ▀▄▀▄▀ █▀█ ░█░ █▄▄ █▀█

                          NetWatch v${package.version} started`);


banner.push("――――――――――――――――――――――――――――――――――");

console.log("\r\n");
for (var i = 0; i < banner.length; i++) {
  log.startup(banner[i]);
}
