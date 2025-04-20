const { DBElitebotixOsuMultiGames, DBElitebotixProcessQueue, DBElitebotixOsuMultiGameScores } = require("./dbObjects");
const osu = require('node-osu');
const { saveOsuMultiScores } = require(`${process.env.ELITEBOTIXROOTPATH}/utils`);
const { verifyMatches } = require('./verifyMatches');

module.exports = {
	async processIncompleteScores() {
		let incompleteMatchScore = await DBElitebotixOsuMultiGames.findOne({
			attributes: ['id', 'matchId', 'updatedAt'],
			where: {
				tourneyMatch: true,
				warmup: null
			},
			order: [
				['updatedAt', 'ASC']
			]
		});

		if (incompleteMatchScore) {
			let APItoken = process.env.OSUTOKENSV1.split('-')[parseInt(incompleteMatchScore.matchId) % process.env.OSUTOKENSV1.split('-').length];

			const osuApi = new osu.Api(APItoken, {
				// baseUrl: sets the base api url (default: https://osu.ppy.sh/api)
				notFoundAsError: true, // Throw an error on not found instead of returning nothing. (default: true)
				completeScores: false, // When fetching scores also fetch the beatmap they are for (Allows getting accuracy) (default: false)
				parseNumeric: false // Parse numeric values into numbers/floats, excluding ids
			});

			await osuApi.getMatch({ mp: incompleteMatchScore.matchId })
				.then(async (match) => {
					await DBElitebotixProcessQueue.create({
						guildId: 'None',
						task: 'messageChannel',
						additions: `${process.env.REIMPORTMATCHLOG};<https://osu.ppy.sh/mp/${match.id}> | ${incompleteMatchScore.updatedAt.getUTCHours().toString().padStart(2, 0)}:${incompleteMatchScore.updatedAt.getUTCMinutes().toString().padStart(2, 0)} ${incompleteMatchScore.updatedAt.getUTCDate().toString().padStart(2, 0)}.${(incompleteMatchScore.updatedAt.getUTCMonth() + 1).toString().padStart(2, 0)}.${incompleteMatchScore.updatedAt.getUTCFullYear()} | \`${match.name}\``,
						priority: 1,
						date: new Date()
					});

					incompleteMatchScore.changed('updatedAt', true);
					await incompleteMatchScore.save();

					await saveOsuMultiScores(match);
				})
				.catch(async (err) => {
					let incompleteGames = await DBElitebotixOsuMultiGames.findAll({
						attributes: ['id', 'warmup', 'updatedAt'],
						where: {
							matchId: incompleteMatchScore.matchId
						}
					});

					let incompleteScores = await DBElitebotixOsuMultiGameScores.findAll({
						attributes: ['id', 'maxCombo', 'pp', 'updatedAt'],
						where: {
							matchId: incompleteMatchScore.matchId
						}
					});

					if (err.message === 'Not found') {
						for (let i = 0; i < incompleteGames.length; i++) {
							incompleteGames[i].warmup = false;
							await incompleteGames[i].save();
						}

						for (let i = 0; i < incompleteScores.length; i++) {
							incompleteScores[i].maxCombo = 0;
							incompleteScores[i].pp = 0;
							await incompleteScores[i].save();
						}
					} else {
						for (let i = 0; i < incompleteGames.length; i++) {
							incompleteGames[i].changed('updatedAt', true);
							await incompleteGames[i].save();
						}

						for (let i = 0; i < incompleteScores.length; i++) {
							incompleteScores[i].changed('updatedAt', true);
							await incompleteScores[i].save();
						}
					}
				});

			//Return after 5 seconds for dev
			if (process.env.SERVER === 'Dev') {
				await new Promise(resolve => setTimeout(resolve, 5 * 1000));
				return;
			}

			//Return after 1 minutes for live
			await new Promise(resolve => setTimeout(resolve, 1 * 60 * 1000));
			return;
		}

		//Verify matches instead if no incomplete matches
		return await verifyMatches();
	}
};
