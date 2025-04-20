const { DBElitebotixOsuMultiGames } = require("./dbObjects");
const osu = require('node-osu');

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

		console.log('incompleteMatchScore', incompleteMatchScore);

		if (incompleteMatchScore) {
			const osuApi = new osu.Api(APItoken, {
				// baseUrl: sets the base api url (default: https://osu.ppy.sh/api)
				notFoundAsError: true, // Throw an error on not found instead of returning nothing. (default: true)
				completeScores: false, // When fetching scores also fetch the beatmap they are for (Allows getting accuracy) (default: false)
				parseNumeric: false // Parse numeric values into numbers/floats, excluding ids
			});

			await osuApi.getMatch({ mp: incompleteMatchScore.matchId })
				.then(async (match) => {
					if (logBroadcastEval) {
						// eslint-disable-next-line no-console
						console.log('Broadcasting processQueueTasks/saveMultiMatches.js incompleteMatchScore to shards...');
					}

					client.shard.broadcastEval(async (c, { channelId, message }) => {
						let channel = await c.channels.cache.get(channelId);
						if (channel) {
							await channel.send(message);
						}
					}, { context: { channelId: channelId, message: `<https://osu.ppy.sh/mp/${match.id}> | ${incompleteMatchScore.updatedAt.getUTCHours().toString().padStart(2, 0)}:${incompleteMatchScore.updatedAt.getUTCMinutes().toString().padStart(2, 0)} ${incompleteMatchScore.updatedAt.getUTCDate().toString().padStart(2, 0)}.${(incompleteMatchScore.updatedAt.getUTCMonth() + 1).toString().padStart(2, 0)}.${incompleteMatchScore.updatedAt.getUTCFullYear()} | \`${match.name}\`` } });

					incompleteMatchScore.changed('updatedAt', true);
					await incompleteMatchScore.save();

					await saveOsuMultiScores(match, client);
				})
				.catch(async (err) => {
					logDatabaseQueries(2, 'saveOsuMultiScores.js DBOsuMultiGames incomplete scores backup');
					let incompleteGames = await DBOsuMultiGames.findAll({
						attributes: ['id', 'warmup', 'updatedAt'],
						where: {
							matchId: incompleteMatchScore.matchId
						}
					});

					logDatabaseQueries(2, 'saveOsuMultiScores.js DBOsuMultiGameScores incomplete scores backup');
					let incompleteScores = await DBOsuMultiGameScores.findAll({
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
		}

		//Return after 1 minutes
		await new Promise(resolve => setTimeout(resolve, 1 * 60 * 1000));
		return;
	}
};
