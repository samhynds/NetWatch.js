var colors = require('colors');
var moment = require('moment');
var fs = require('fs');
var path = require('path');
require("dotenv").config();

var LOG_LOCATION = './logs';
var DATE_FORMAT = 'DD/MM/YYYY - HH:mm:ss.SSS';

var day = moment(Date.now()).format("DD-MM-YYYY");
var logFileName = `${process.env.APP_NAME.replace(/\s+/g, '_')}_${day}.log`;

var log = {};

log.fileStream = fs.createWriteStream(path.resolve(LOG_LOCATION, logFileName), { flags: 'a', encoding: 'utf8' });

// Pipe errors not handled by the logging library to the file.
process.stderr.write = function (stream) {
	log.error(stream);
}

process.on('uncaughtException', function (err) {
	log.error(`[UNCAUGHT EXCEPTION] ${err.message}: ${(err && err.stack) ? err.stack : err}`);
});


log.quiet = function (bool) {
	if (bool) {
		var quiet = function () { return; }

		log.info = quiet;
		log.success = quiet;
		log.funky = quiet;
	} else {
		log.info = log.info;
		log.success = log.success;
		log.funky = log.funky;
	}
}

// Initialises logging system

log.call = function (color, type) {
	if (color == undefined) color = 'white';

	var args = Array.prototype.slice.call(arguments.callee.caller.arguments);
	var timestamp = moment(Date.now()).format(DATE_FORMAT);

	log.formatAndOutput(args, timestamp, color, type);

}

// Express middleware for custom log
log.express = function (req, res, next) {
	log.log(`[EXPRESS] ${req.method} ${req.baseUrl}${req.url} ${res.statusCode} from ${req.ip}`);
	next();
}

log.formatAndOutput = function (args, timestamp, color, type) {

	if (type !== 'debug') log.toFile(args, timestamp, type);

	// Add colours and output to cmdline
	for (var i = 0; i < args.length; i++) {
		if (typeof args[i] === 'string') {
			args[i] = colors[color](args[i]);
		}
	};

	args.unshift(colors.grey(timestamp));
	console.log.apply(console, args);
}

log.toFile = function (args, timestamp, type) {
	var newDay = moment(Date.now()).format("DD-MM-YYYY");

	if (newDay !== day) {
		day = moment(Date.now()).format("DD-MM-YYYY");
		logFileName = `${process.env.APP_NAME}_${day}.log`;
		log.fileStream = fs.createWriteStream(path.resolve(LOG_LOCATION, logFileName), { flags: 'a', encoding: 'utf8' });
	}

	log.fileStream.write(`${timestamp} [${type.toUpperCase()}] ${args.join("")} \n`);
}

log.log = function () {
	msgColor = 'white';
	log.call(msgColor, 'log');
}

log.debug = function () {
	msgColor = 'white';
	log.call(msgColor, 'debug');
}

log.success = function () {
	msgColor = 'green';
	log.call(msgColor, 'success');
}

log.info = function () {
	msgColor = 'blue';
	log.call(msgColor, 'info');
}

log.warn = function () {
	msgColor = 'yellow';
	log.call(msgColor, 'warn');
}

log.error = function () {
	msgColor = 'red';
	log.call(msgColor, 'error');
}

log.emerg = function () {
	msgColor = 'bgRed';
	log.call(msgColor, 'emergency');
}

log.funky = function () {
	msgColor = 'rainbow';
	log.call(msgColor, 'funky');
}

log.grey = function () {
	msgColor = 'grey';
	log.call(msgColor, 'grey');
}

log.startup = function () {
	msgColor = 'grey';
	log.call(msgColor, 'startup');
}

module.exports = log;