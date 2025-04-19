const Sequelize = require('sequelize');
require('dotenv').config();

const elitebotixMultiGameScores = new Sequelize('database', 'username', 'password', {
	host: 'localhost',
	dialect: 'sqlite',
	logging: false,
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

const elitebotixMultiMatches = new Sequelize('database', 'username', 'password', {
	host: 'localhost',
	dialect: 'sqlite',
	logging: false,
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

const DBElitebotixOsuMultiMatches = require(`${process.env.ELITEBOTIXROOTPATH}/models/DBOsuMultiMatches`)(elitebotixMultiMatches, Sequelize.DataTypes);
const DBElitebotixOsuMultiGameScores = require(`${process.env.ELITEBOTIXROOTPATH}/models/DBOsuMultiGameScores`)(elitebotixMultiGameScores, Sequelize.DataTypes);

module.exports = {
	DBElitebotixOsuMultiMatches,
	DBElitebotixOsuMultiGameScores,
};
