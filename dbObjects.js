const pg = require('pg');
pg.types.setTypeParser(20, val => parseInt(val, 10));

const Sequelize = require('sequelize');
require('dotenv').config();

const elitebotixPostgres = new Sequelize('elitebotix', 'elitebotix', process.env.POSTGRESQLPASSWORD, {
	dialect: 'postgres',
	host: 'localhost',
	port: 5432,
	logging: async (msg) => {
		console.log(`[SQL]: ${msg}`);
		if (process.shardId !== undefined) {
			process.send('DB postgres');
		}
	},
	pool: {
		max: 10,
		min: 2,
		acquire: 30000,
		idle: 10000,
	},
});

elitebotixPostgres.authenticate()
	.then(() => console.log('✅ Connected to database'))
	.catch(err => console.error('❌ Failed to connect to database:', err));

const DBElitebotixProcessQueue = require(`${process.env.ELITEBOTIXROOTPATH}/models/DBProcessQueue`)(elitebotixPostgres, Sequelize.DataTypes);
const DBElitebotixOsuMultiMatches = require(`${process.env.ELITEBOTIXROOTPATH}/models/DBOsuMultiMatches`)(elitebotixPostgres, Sequelize.DataTypes);
const DBElitebotixOsuMultiGames = require(`${process.env.ELITEBOTIXROOTPATH}/models/DBOsuMultiGames`)(elitebotixPostgres, Sequelize.DataTypes);
const DBElitebotixOsuMultiGameScores = require(`${process.env.ELITEBOTIXROOTPATH}/models/DBOsuMultiGameScores`)(elitebotixPostgres, Sequelize.DataTypes);

module.exports = {
	DBElitebotixProcessQueue,
	DBElitebotixOsuMultiMatches,
	DBElitebotixOsuMultiGames,
	DBElitebotixOsuMultiGameScores,
};
