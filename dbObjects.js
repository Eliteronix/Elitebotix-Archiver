const Sequelize = require('sequelize');
require('dotenv').config();
const { processQueueAccesses, multiGameScoresAccesses, multiGamesAccesses, multiMatchesAccesses } = require('./metrics');

const elitebotixProcessQueue = new Sequelize('database', 'username', 'password', {
	host: 'localhost',
	dialect: 'sqlite',
	logging: async () => {
		processQueueAccesses.inc();
	},
	storage: `${process.env.ELITEBOTIXROOTPATH}/databases/processQueue.sqlite`,
	retry: {
		max: 25, // Maximum retry 15 times
		backoffBase: 100, // Initial backoff duration in ms. Default: 100,
		backoffExponent: 1.14, // Exponent to increase backoff each try. Default: 1.1
	},
	pool: {
		max: 7,
	}
});

const elitebotixMultiGameScores = new Sequelize('database', 'username', 'password', {
	host: 'localhost',
	dialect: 'sqlite',
	logging: async () => {
		multiGameScoresAccesses.inc();
	},
	storage: `${process.env.ELITEBOTIXROOTPATH}/databases/multiGameScores.sqlite`,
	retry: {
		max: 25, // Maximum retry 15 times
		backoffBase: 100, // Initial backoff duration in ms. Default: 100,
		backoffExponent: 1.14, // Exponent to increase backoff each try. Default: 1.1
	},
	pool: {
		max: 7,
	}
});

const elitebotixMultiGames = new Sequelize('database', 'username', 'password', {
	host: 'localhost',
	dialect: 'sqlite',
	logging: async () => {
		multiGamesAccesses.inc();
	},
	storage: `${process.env.ELITEBOTIXROOTPATH}/databases/multiGames.sqlite`,
	retry: {
		max: 25, // Maximum retry 15 times
		backoffBase: 100, // Initial backoff duration in ms. Default: 100,
		backoffExponent: 1.14, // Exponent to increase backoff each try. Default: 1.1
	},
	pool: {
		max: 7,
	}
});

const elitebotixMultiMatches = new Sequelize('database', 'username', 'password', {
	host: 'localhost',
	dialect: 'sqlite',
	logging: async () => {
		multiMatchesAccesses.inc();
	},
	storage: `${process.env.ELITEBOTIXROOTPATH}/databases/multiMatches.sqlite`,
	retry: {
		max: 25, // Maximum retry 15 times
		backoffBase: 100, // Initial backoff duration in ms. Default: 100,
		backoffExponent: 1.14, // Exponent to increase backoff each try. Default: 1.1
	},
	pool: {
		max: 7,
	}
});

const DBElitebotixProcessQueue = require(`${process.env.ELITEBOTIXROOTPATH}/models/DBProcessQueue`)(elitebotixProcessQueue, Sequelize.DataTypes);
const DBElitebotixOsuMultiMatches = require(`${process.env.ELITEBOTIXROOTPATH}/models/DBOsuMultiMatches`)(elitebotixMultiMatches, Sequelize.DataTypes);
const DBElitebotixOsuMultiGames = require(`${process.env.ELITEBOTIXROOTPATH}/models/DBOsuMultiGames`)(elitebotixMultiGames, Sequelize.DataTypes);
const DBElitebotixOsuMultiGameScores = require(`${process.env.ELITEBOTIXROOTPATH}/models/DBOsuMultiGameScores`)(elitebotixMultiGameScores, Sequelize.DataTypes);

module.exports = {
	DBElitebotixProcessQueue,
	DBElitebotixOsuMultiMatches,
	DBElitebotixOsuMultiGames,
	DBElitebotixOsuMultiGameScores,
};
