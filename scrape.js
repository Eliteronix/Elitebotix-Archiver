const { DBElitebotixOsuMultiMatches } = require('./dbObjects');
const { Op } = require('sequelize');

module.exports = {
	async scrape() {
		console.log('Scraping for new matches...');
		const fs = require('fs');

		//Check if the lastImport.json file exists
		if (!fs.existsSync(`./lastImport.json`)) {
			//Get the match that was most recently imported thats older than 24 hours
			let recentImport = await DBElitebotixOsuMultiMatches.findOne({
				attributes: ['matchId'],
				where: {
					createdAt: {
						[Op.lt]: new Date(Date.now() - 24 * 60 * 60 * 1000),
					},
				},
				order: [['matchId', 'DESC']],
			});

			let lastImport = {
				matchId: 0,
			};

			//If no recent import was found, set it to 0
			if (recentImport) {
				lastImport = {
					matchId: recentImport.matchId,
				};
			}

			console.log('No lastImport.json file found. Setting lastImport to:', lastImport.matchId);

			//Create the lastImport.json file
			fs.writeFileSync(`./lastImport.json`, JSON.stringify(lastImport, null, 2), 'utf-8');
		}
	},
};