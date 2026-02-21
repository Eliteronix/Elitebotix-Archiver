//Log message upon starting the bot
// eslint-disable-next-line no-console
console.log('Bot is starting...');

require('dotenv').config();

const originalConsoleError = console.error;
const { totalErrorCount } = require('./metrics.js');

console.error = function (...args) {
	totalErrorCount.inc();
	originalConsoleError.apply(console, args);
};

const http = require('http');
const url = require('url');
const { register } = require('./metrics.js');
const { scrape } = require('./scrape.js');

// Define the HTTP server
const server = http.createServer(async (req, res) => {
	// Retrieve route from request object
	const route = url.parse(req.url).pathname;

	if (route === '/metrics') {
		try {
			// Return all metrics the Prometheus exposition format
			res.setHeader('Content-Type', register.contentType);
			res.end(await register.metrics());
		} catch (e) {
			console.error('index.js | /metrics', e);
			res.statusCode = 500;
			res.end('Internal Server Error');
		}
	}
});

// Start the HTTP server which exposes the metrics on http://localhost:8081/metrics
server.listen(8081);

scrapeForNewMatches();

async function scrapeForNewMatches() {
	try {
		await scrape();
	} catch (e) {
		console.error('index.js | scrape', e);
	}

	setTimeout(() => {
		scrapeForNewMatches();
	}, 650);
}

process.on('unhandledRejection', (reason, promise) => {
	console.error('Unhandled rejection, index.js:', reason, promise);
});