const { DBElitebotixOsuMultiMatches, DBElitebotixOsuMultiGames, DBElitebotixOsuMultiGameScores, DBElitebotixProcessQueue } = require('./dbObjects');
const { matchmaking, logVerificationProcess, verificationUser } = require('./config.json');
const { Op } = require('sequelize');
const osu = require('node-osu');

module.exports = {
	async verifyMatches() {
		console.log('Verifying matches...');

		// Check for matchmaking first
		for (let i = 0; i < matchmaking.length; i++) {
			let verifyMatch = await DBElitebotixOsuMultiMatches.findOne({
				attributes: ['matchId'],
				where: {
					tourneyMatch: true,
					verifiedAt: null,
					verifiedBy: null,
					matchName: {
						[Op.startsWith]: matchmaking[i].acronym,
					},
					matchEndDate: {
						[Op.not]: null,
					},
				},
				order: [
					['matchId', 'ASC']
				]
			});

			if (!verifyMatch) {
				continue;
			}

			let APItoken = process.env.OSUTOKENSV1.split('-')[parseInt(verifyMatch.matchId) % process.env.OSUTOKENSV1.split('-').length];

			const osuApi = new osu.Api(APItoken, {
				// baseUrl: sets the base api url (default: https://osu.ppy.sh/api)
				notFoundAsError: true, // Throw an error on not found instead of returning nothing. (default: true)
				completeScores: false, // When fetching scores also fetch the beatmap they are for (Allows getting accuracy) (default: false)
				parseNumeric: false // Parse numeric values into numbers/floats, excluding ids
			});

			await osuApi.getMatch({ mp: verifyMatch.matchId })
				.then(async (match) => {
					try {
						await fetch(`https://osu.ppy.sh/community/matches/${match.id}`)
							.then(async (res) => {
								let htmlCode = await res.text();
								htmlCode = htmlCode.replace(/&quot;/gm, '"');
								const matchRunningRegex = /{"match".+,"current_game_id":\d+}/gm;
								const matchPausedRegex = /{"match".+,"current_game_id":null}/gm;
								const matchesRunning = matchRunningRegex.exec(htmlCode);
								const matchesPaused = matchPausedRegex.exec(htmlCode);

								let regexMatch = null;
								if (matchesRunning && matchesRunning[0]) {
									regexMatch = matchesRunning[0];
								}

								if (matchesPaused && matchesPaused[0]) {
									regexMatch = matchesPaused[0];
								}

								if (regexMatch) {
									let json = JSON.parse(regexMatch);

									if (json.events[0].detail.type === 'match-created') {
										if (json.events[0].user_id === matchmaking[i].referee) {
											await DBElitebotixOsuMultiMatches.update({
												tourneyMatch: true,
												verifiedAt: new Date(),
												verifiedBy: verificationUser.osuUserId, // Elitebotix
												verificationComment: `Match created by ${matchmaking[i].refereeName}`,
												referee: json.events[0].user_id,
											}, {
												where: {
													matchId: match.id,
												},
											});

											await DBElitebotixOsuMultiGames.update({
												tourneyMatch: true,
											}, {
												where: {
													matchId: match.id,
												},
											});

											await DBElitebotixOsuMultiGameScores.update({
												tourneyMatch: true,
											}, {
												where: {
													matchId: match.id,
												},
											});

											if (logVerificationProcess) {
												// eslint-disable-next-line no-console
												console.log(`Match ${match.id} verified - Match created by ${matchmaking[i].refereeName}`);
											}

											await DBElitebotixProcessQueue.create({
												guildId: 'None',
												task: 'messageChannel',
												additions: `${process.env.VERIFICATIONLOG};\`\`\`diff\n+ Valid: True\nComment: Match created by ${matchmaking[i].refereeName}\`\`\`https://osu.ppy.sh/mp/${match.id} was verified by ${verificationUser.username}#${verificationUser.discriminator} (<@${verificationUser.clientId}> | <https://osu.ppy.sh/users/${verificationUser.osuUserId}>)`,
												priority: 1,
												date: new Date()
											});
										} else {
											await DBElitebotixOsuMultiMatches.update({
												tourneyMatch: false,
												verifiedAt: new Date(),
												verifiedBy: verificationUser.osuUserId, // Elitebotix
												verificationComment: `Match not created by ${matchmaking[i].refereeName}`,
												referee: json.events[0].user_id,
											}, {
												where: {
													matchId: match.id,
												},
											});

											await DBElitebotixOsuMultiGames.update({
												tourneyMatch: false,
											}, {
												where: {
													matchId: match.id,
												},
											});

											await DBElitebotixOsuMultiGameScores.update({
												tourneyMatch: false,
											}, {
												where: {
													matchId: match.id,
												},
											});

											if (logVerificationProcess) {
												// eslint-disable-next-line no-console
												console.log(`Match ${match.id} verified as fake - Match not created by ${matchmaking[i].refereeName}`);
											}

											await DBElitebotixProcessQueue.create({
												guildId: 'None',
												task: 'messageChannel',
												additions: `${process.env.VERIFICATIONLOG};\`\`\`ini\n[Changed]\`\`\`\`\`\`diff\n- Valid: False\nComment: Match not created by ${matchmaking[i].refereeName}\`\`\`https://osu.ppy.sh/mp/${match.id} was verified by ${verificationUser.username}#${verificationUser.discriminator} (<@${verificationUser.clientId}> | <https://osu.ppy.sh/users/${verificationUser.osuUserId}>)`,
												priority: 1,
												date: new Date()
											});
										}
									} else {
										await DBElitebotixOsuMultiMatches.update({
											verifiedBy: verificationUser.osuUserId, // Elitebotix
											verificationComment: `Not determinable if match was created by ${matchmaking[i].refereeName}`,
										}, {
											where: {
												matchId: match.id,
											},
										});

										if (logVerificationProcess) {
											// eslint-disable-next-line no-console
											console.log(`Match ${match.id} not verified - Not determinable if match was created by ${matchmaking[i].refereeName}`);
										}
									}
								}
							});
					} catch (e) {
						if (!e.message.endsWith('reason: Client network socket disconnected before secure TLS connection was established')
							&& !e.message.endsWith('reason: read ECONNRESET')) {
							console.error(e);
						}
						// Go same if error and wait a bit longer
						await new Promise(resolve => setTimeout(resolve, 4 * 60 * 1000));
					}
				})
				.catch(async (err) => {
					if (err.message === 'Not found') {
						//If its not found anymore it should be fake because it must be created in a different way
						await DBElitebotixOsuMultiMatches.update({
							tourneyMatch: false,
							verifiedAt: new Date(),
							verifiedBy: verificationUser.osuUserId, // Elitebotix
							verificationComment: `${matchmaking[i].acronym} not found - Fake because ${matchmaking[i].refereeName} uses !mp make to create matches`,
						}, {
							where: {
								matchId: verifyMatch.matchId,
							},
						});

						await DBElitebotixOsuMultiGames.update({
							tourneyMatch: false,
						}, {
							where: {
								matchId: verifyMatch.matchId,
							},
						});

						await DBElitebotixOsuMultiGameScores.update({
							tourneyMatch: false,
						}, {
							where: {
								matchId: verifyMatch.matchId,
							},
						});

						if (logVerificationProcess) {
							// eslint-disable-next-line no-console
							console.log(`Match ${verifyMatch.matchId} verified as fake - ${matchmaking[i].acronym} not found - Fake because MaidBot uses !mp make to create matches`);
						}

						await DBElitebotixProcessQueue.create({
							guildId: 'None',
							task: 'messageChannel',
							additions: `${process.env.VERIFICATIONLOG};\`\`\`ini\n[Changed]\`\`\`\`\`\`diff\n- Valid: False\nComment: ${matchmaking[i].acronym} not found - Fake because ${matchmaking[i].refereeName} uses !mp make to create matches\`\`\`https://osu.ppy.sh/mp/${verifyMatch.matchId} was verified by ${verificationUser.username}#${verificationUser.discriminator} (<@${verificationUser.clientId}> | <https://osu.ppy.sh/users/${verificationUser.osuUserId}>)`,
							priority: 1,
							date: new Date()
						});
					} else {
						// Go same if error and wait a bit longer
						await new Promise(resolve => setTimeout(resolve, 4 * 60 * 1000));
					}
				});

			// Wait a minute between verifications to not spam the API / get rate limited
			await new Promise(resolve => setTimeout(resolve, 1 * 60 * 1000));
			return;
		}

		console.log('No more matchmaking matches to verify');
		await new Promise(resolve => setTimeout(resolve, 1 * 60 * 1000));
		return;
	}
};
