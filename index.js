//Log message upon starting the bot
// eslint-disable-next-line no-console
console.log('Bot is starting...');

require('dotenv').config();

const { scrape } = require('./scrape.js');

scrapeForNewMatches();

async function scrapeForNewMatches() {
	try {
		await scrape.execute();
	} catch (e) {
		console.error('index.js | scrape' + e);
	}

	setTimeout(() => {
		scrapeForNewMatches();
	}, 650);
}