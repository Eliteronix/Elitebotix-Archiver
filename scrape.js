const { DBElitebotixOsuMultiMatches, DBElitebotixProcessQueue } = require('./dbObjects');
const { Op } = require('sequelize');
const { processIncompleteScores } = require('./processIncompleteScores');
const osu = require('node-osu');
const { saveOsuMultiScores } = require(`${process.env.ELITEBOTIXROOTPATH}/utils`);

module.exports = {
	async scrape() {
		const fs = require('fs');

		//Check if the lastImport.json file exists
		if (!fs.existsSync('./lastImport.json')) {
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
				lastMatchFound: 0,
			};

			//If no recent import was found, set it to 0
			if (recentImport) {
				lastImport = {
					matchId: recentImport.matchId,
					lastMatchFound: recentImport.matchId,
				};
			}

			// eslint-disable-next-line no-console
			console.log('No lastImport.json file found. Setting lastImport to:', lastImport.matchId);

			//Create the lastImport.json file
			fs.writeFileSync('./lastImport.json', JSON.stringify(lastImport, null, 2), 'utf-8');
		}

		if (process.env.SERVER === 'Dev') {
			return await processIncompleteScores();
		}

		//Read the lastImport.json file
		let lastImport = JSON.parse(fs.readFileSync('./lastImport.json', 'utf-8'));

		let APItoken = process.env.OSUTOKENSV1.split('-')[parseInt(lastImport.matchId) % process.env.OSUTOKENSV1.split('-').length];

		const osuApi = new osu.Api(APItoken, {
			// baseUrl: sets the base api url (default: https://osu.ppy.sh/api)
			notFoundAsError: true, // Throw an error on not found instead of returning nothing. (default: true)
			completeScores: false, // When fetching scores also fetch the beatmap they are for (Allows getting accuracy) (default: false)
			parseNumeric: false // Parse numeric values into numbers/floats, excluding ids
		});

		await osuApi.getMatch({ mp: lastImport.matchId })
			.then(async (match) => {
				lastImport.lastMatchFound = lastImport.matchId;
				lastImport.matchStart = Date.parse(match.raw_start);

				let sixHoursAgo = new Date();
				sixHoursAgo.setUTCHours(sixHoursAgo.getUTCHours() - 6);

				let fiveMinutesAgo = new Date();
				fiveMinutesAgo.setUTCMinutes(fiveMinutesAgo.getUTCMinutes() - 5);
				if (match.raw_end || Date.parse(match.raw_start) < sixHoursAgo) {
					if (match.name.toLowerCase().match(/.+:.+vs.+/g)) {
						await saveOsuMultiScores(match);
						let now = new Date();
						let minutesBehindToday = parseInt((now.getTime() - Date.parse(match.raw_start)) / 1000 / 60) % 60;
						let hoursBehindToday = parseInt((now.getTime() - Date.parse(match.raw_start)) / 1000 / 60 / 60) % 24;
						let daysBehindToday = parseInt((now.getTime() - Date.parse(match.raw_start)) / 1000 / 60 / 60 / 24);

						await DBElitebotixProcessQueue.create({
							guildId: 'None',
							task: 'messageChannel',
							additions: `${process.env.IMPORTMATCHLOG};<https://osu.ppy.sh/mp/${lastImport.matchId}> ${daysBehindToday}d ${hoursBehindToday}h ${minutesBehindToday}m \`${match.name}\` done`,
							priority: 1,
							date: new Date()
						});
					}

					//Go next if match found and ended / too long going already
					lastImport.matchId = lastImport.matchId + 1;

					//Create the lastImport.json file
					fs.writeFileSync('./lastImport.json', JSON.stringify(lastImport, null, 2), 'utf-8');
					return;
				} else if (Date.parse(match.raw_start) < fiveMinutesAgo) {
					if (match.name.toLowerCase().match(/.+:.+vs.+/g)) {
						await saveOsuMultiScores(match);
						let date = new Date();
						date.setUTCMinutes(date.getUTCMinutes() + 5);
						await DBElitebotixProcessQueue.create({
							guildId: 'None',
							task: 'importMatch',
							additions: `${lastImport.matchId};1;${Date.parse(match.raw_start)};${match.name}`,
							priority: 1,
							date: date
						});
						await DBElitebotixProcessQueue.create({
							guildId: 'none',
							task: 'updateCurrentMatches',
							date: new Date(),
							priority: 0
						});
					}

					//Go next if match found and ended / too long going already
					lastImport.matchId = lastImport.matchId + 1;

					//Create the lastImport.json file
					fs.writeFileSync('./lastImport.json', JSON.stringify(lastImport, null, 2), 'utf-8');
					return;
				}

				return await processIncompleteScores();
			})
			.catch(async (err) => {
				if (err.message === 'Not found') {
					//Fallback in case we got ahead of the matches
					if (lastImport.lastMatchFound < lastImport.matchId - 100) {
						lastImport.matchId = lastImport.lastMatchFound;
						// eslint-disable-next-line no-console
						console.log('Match not found for 100 matches in a row, going back to last match found:', lastImport.matchId);
					} else {
						//Go next if match not found
						lastImport.matchId = lastImport.matchId + 1;
					}

					//Create the lastImport.json file
					fs.writeFileSync('./lastImport.json', JSON.stringify(lastImport, null, 2), 'utf-8');
					return;
				} else {
					try {
						// Check using node fetch
						const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
						let response = await fetch(`https://osu.ppy.sh/community/matches/${parseInt(lastImport.matchId)}`);
						let htmlCode = await response.text();
						let isolatedContent = htmlCode.replace(/[\s\S]+<script id="json-events" type="application\/json">/gm, '').replace(/<\/script>[\s\S]+/gm, '');
						let json = JSON.parse(isolatedContent);
						if (Date.parse(json.events[json.events.length - 1].timestamp) - Date.parse(json.match.start_time) > 86400000) {
							//Go next if over 24 hours long game
							lastImport.matchId = lastImport.matchId + 1;

							//Create the lastImport.json file
							fs.writeFileSync('./lastImport.json', JSON.stringify(lastImport, null, 2), 'utf-8');
							return;
						} else {
							return;
						}
					} catch (error) {
						console.error(error, `API Key Index ${parseInt(lastImport.matchId) % process.env.OSUTOKENSV1.split('-').length} going same saveMultiMatches.js https://osu.ppy.sh/community/matches/${parseInt(lastImport.matchId)}`);
						//Go same if error
						//Return after 5 minutes
						await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
						return;
					}
				}
			});
	},
};