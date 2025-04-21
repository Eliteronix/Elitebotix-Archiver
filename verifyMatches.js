const { DBElitebotixOsuMultiMatches, DBElitebotixOsuMultiGames, DBElitebotixOsuMultiGameScores, DBElitebotixProcessQueue } = require('./dbObjects');
const { matchmaking, logVerificationProcess, verificationUser } = require('./config.json');
const { Op } = require('sequelize');
const osu = require('node-osu');
const fs = require('fs');

module.exports = {
	async verifyMatches() {
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





		// Verify ETX Matches if no matchmaking matches are found
		// Get all matchLogs that contain "Looking for a map..." and are not verified
		if (!fs.existsSync(`${process.env.ELITEBOTIXBANCHOROOTPATH}/matchLogs`)) {
			fs.mkdirSync(`${process.env.ELITEBOTIXBANCHOROOTPATH}/matchLogs`);
		}

		let matchesToVerify = await DBElitebotixOsuMultiMatches.findAll({
			attributes: ['matchId'],
			where: {
				tourneyMatch: true,
				verifiedAt: null,
				matchName: {
					[Op.startsWith]: 'ETX',
				},
				matchEndDate: {
					[Op.not]: null,
				},
			},
			group: ['matchId'],
		});

		let matchesToNotVerify = [];

		for (let i = 0; i < matchesToVerify.length; i++) {
			if (!fs.existsSync(`${process.env.ELITEBOTIXBANCHOROOTPATH}/matchLogs/${matchesToVerify[i].matchId}.txt`)) {
				matchesToNotVerify.push(matchesToVerify[i].matchId);

				matchesToVerify.splice(i, 1);
				i--;
				continue;
			}

			let matchLog = fs.readFileSync(`${process.env.ELITEBOTIXBANCHOROOTPATH}/matchLogs/${matchesToVerify[i].matchId}.txt`, 'utf8');

			if (!(matchLog.includes('[Eliteronix]: Looking for a map...') || matchLog.includes('[Elitebotix]: Looking for a map...') || matchLog.length === 0)) {
				matchesToNotVerify.push(matchesToVerify[i].matchId);

				matchesToVerify.splice(i, 1);
				i--;
				continue;
			}
		}

		matchesToVerify = matchesToVerify.map(match => match.matchId);

		if (matchesToVerify.length) {
			// If there is a match to verify
			await DBElitebotixOsuMultiMatches.update({
				tourneyMatch: true,
				verifiedAt: new Date(),
				verifiedBy: verificationUser.osuUserId, // Elitebotix
				verificationComment: 'Elitebotix Duel Match',
				referee: 31050083, // Elitebotix
			}, {
				where: {
					matchId: {
						[Op.in]: matchesToVerify,
					},
				},
			});

			await DBElitebotixOsuMultiGames.update({
				tourneyMatch: true,
			}, {
				where: {
					matchId: {
						[Op.in]: matchesToVerify,
					},
				},
			});

			await DBElitebotixOsuMultiGameScores.update({
				tourneyMatch: true,
			}, {
				where: {
					matchId: {
						[Op.in]: matchesToVerify,
					},
				},
			});

			for (let i = 0; i < matchesToVerify.length; i++) {
				if (logVerificationProcess) {
					// eslint-disable-next-line no-console
					console.log(`Match ${matchesToVerify[i]} verified - Elitebotix Duel Match`);
				}

				await DBElitebotixProcessQueue.create({
					guildId: 'None',
					task: 'messageChannel',
					additions: `${process.env.VERIFICATIONLOG};\`\`\`diff\n+ Valid: True\nComment: Elitebotix Duel Match\`\`\`https://osu.ppy.sh/mp/${matchesToVerify[i]} was verified by ${verificationUser.username}#${verificationUser.discriminator} (<@${verificationUser.clientId}> | <https://osu.ppy.sh/users/${verificationUser.osuUserId}>)`,
					priority: 1,
					date: new Date()
				});
			}

			await new Promise(resolve => setTimeout(resolve, 1 * 60 * 1000));
			return;
		}

		if (matchesToNotVerify.length) {
			// If there is a match to unverify
			await DBElitebotixOsuMultiMatches.update({
				tourneyMatch: false,
				verifiedAt: new Date(),
				verifiedBy: verificationUser.osuUserId, // Elitebotix
				verificationComment: 'Fake Elitebotix Duel Match - No match log found',
			}, {
				where: {
					matchId: {
						[Op.in]: matchesToNotVerify,
					},
				},
			});

			await DBElitebotixOsuMultiGames.update({
				tourneyMatch: false,
			}, {
				where: {
					matchId: {
						[Op.in]: matchesToNotVerify,
					},
				},
			});

			await DBElitebotixOsuMultiGameScores.update({
				tourneyMatch: false,
			}, {
				where: {
					matchId: {
						[Op.in]: matchesToNotVerify,
					},
				},
			});

			for (let i = 0; i < matchesToNotVerify.length; i++) {
				if (logVerificationProcess) {
					// eslint-disable-next-line no-console
					console.log(`Match ${matchesToNotVerify[i]} unverified - Fake Elitebotix Duel Match - No match log found`);
				}

				await DBElitebotixProcessQueue.create({
					guildId: 'None',
					task: 'messageChannel',
					additions: `${process.env.VERIFICATIONLOG};\`\`\`diff\n- Valid: False\nComment: Fake Elitebotix Duel Match - No match log found\`\`\`https://osu.ppy.sh/mp/${matchesToNotVerify[i]} was unverified by ${verificationUser.username}#${verificationUser.discriminator} (<@${verificationUser.clientId}> | <https://osu.ppy.sh/users/${verificationUser.osuUserId}>)`,
					priority: 1,
					date: new Date()
				});
			}

			await new Promise(resolve => setTimeout(resolve, 1 * 60 * 1000));
			return;
		}





		// Verify any remaining matches that are not verified
		let matchToVerify = await DBElitebotixOsuMultiMatches.findOne({
			attributes: ['matchId', 'matchName', 'matchStartDate'],
			where: {
				tourneyMatch: true,
				verifiedBy: null,
				referee: null,
			},
			order: [
				['matchId', 'ASC']
			]
		});

		if (!matchToVerify) {
			matchToVerify = await DBElitebotixOsuMultiMatches.findOne({
				attributes: ['matchId', 'matchName', 'matchStartDate'],
				where: {
					tourneyMatch: true,
					verifiedBy: null,
					matchEndDate: {
						[Op.not]: null,
					},
				},
				order: [
					['updatedAt', 'ASC']
				]
			});
		}

		if (!matchToVerify) {
			if (logVerificationProcess) {
				// eslint-disable-next-line no-console
				console.log('No match to verify');
			}

			console.log('No match to verify');
			await new Promise(resolve => setTimeout(resolve, 1 * 60 * 1000));
			return;
		}

		let APItoken = process.env.OSUTOKENSV1.split('-')[parseInt(matchToVerify.matchId) % process.env.OSUTOKENSV1.split('-').length];

		const osuApi = new osu.Api(APItoken, {
			// baseUrl: sets the base api url (default: https://osu.ppy.sh/api)
			notFoundAsError: true, // Throw an error on not found instead of returning nothing. (default: true)
			completeScores: false, // When fetching scores also fetch the beatmap they are for (Allows getting accuracy) (default: false)
			parseNumeric: false // Parse numeric values into numbers/floats, excluding ids
		});

		await osuApi.getMatch({ mp: matchToVerify.matchId })
			.then(async (match) => {
				try {
					return await fetch(`https://osu.ppy.sh/community/matches/${match.id}`)
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

								while (json.first_event_id !== json.events[0].id) {
									let firstIdInJSON = json.events[0].id;

									let earlierEvents = await fetch(`https://osu.ppy.sh/community/matches/${match.id}?before=${json.events[0].id}&limit=100`)
										.then(async (res) => {
											let htmlCode = await res.text();
											htmlCode = htmlCode.replace(/&quot;/gm, '"');
											const matchRunningRegex = /{"match".+,"current_game_id":\d+}/gm;
											const matchPausedRegex = /{"match".+,"current_game_id":null}/gm;
											const matchesRunning = matchRunningRegex.exec(htmlCode);
											const matchesPaused = matchPausedRegex.exec(htmlCode);

											if (matchesRunning && matchesRunning[0]) {
												regexMatch = matchesRunning[0];
											}

											if (matchesPaused && matchesPaused[0]) {
												regexMatch = matchesPaused[0];
											}

											let json = JSON.parse(regexMatch);

											return json.events;
										});

									json.events = earlierEvents.concat(json.events);

									if (json.events[0].id === firstIdInJSON) {
										break;
									}
								}

								if (json.events[0].detail.type === 'match-created') {
									//Find a score by the match creator
									let scores = await DBElitebotixOsuMultiGameScores.findAll({
										attributes: ['score'],
										where: {
											matchId: match.id,
											osuUserId: json.events[0].user_id,
											score: {
												[Op.gte]: 10000,
											},
										},
									});

									if (scores.length) {
										//Match creator played a round - Not determined if valid
										await DBElitebotixOsuMultiMatches.update({
											verifiedBy: verificationUser.osuUserId, // Elitebotix
											verificationComment: 'Match creator played a round - Not determined if valid',
											referee: json.events[0].user_id,
										}, {
											where: {
												matchId: match.id,
											},
										});

										if (logVerificationProcess) {
											// eslint-disable-next-line no-console
											console.log(`Match ${matchToVerify.matchId} unverified - Match creator played a round - Not determined if valid`);
										}
									} else {
										//Match creator did not play a round - Not determined if valid yet
										let matchToVerifyScores = await DBElitebotixOsuMultiGameScores.findAll({
											attributes: ['osuUserId', 'beatmapId'],
											where: {
												matchId: match.id,
											},
										});

										let mapsPlayed = [];
										let players = [];

										for (let i = 0; i < matchToVerifyScores.length; i++) {
											let score = matchToVerifyScores[i];

											let map = mapsPlayed.find((map) => map.beatmapId === score.beatmapId);

											if (!map) {
												mapsPlayed.push({ beatmapId: score.beatmapId, amount: 0 });
											}

											if (!players.includes(score.osuUserId)) {
												players.push(score.osuUserId);
											}
										}

										let acronym = matchToVerify.matchName.replace(/:.*/gm, '');

										let weeksBeforeMatch = new Date(matchToVerify.matchStartDate);
										weeksBeforeMatch.setDate(weeksBeforeMatch.getDate() - 56);

										let weeksAfterMatch = new Date(matchToVerify.matchStartDate);
										weeksAfterMatch.setDate(weeksAfterMatch.getDate() + 56);

										//Match creator did not play a round
										let relatedMatches = await DBElitebotixOsuMultiMatches.findAll({
											attributes: ['matchId', 'matchName', 'verifiedAt', 'verifiedBy'],
											where: {
												matchStartDate: {
													[Op.between]: [weeksBeforeMatch, weeksAfterMatch],
												},
												matchName: {
													[Op.like]: `${acronym}:%`,
												},
											},
										});

										let relatedGames = await DBElitebotixOsuMultiGames.findAll({
											attributes: ['gameId'],
											where: {
												matchId: {
													[Op.in]: relatedMatches.map((match) => match.matchId),
												},
												warmup: false,
											},
										});

										let relatedScores = await DBElitebotixOsuMultiGameScores.findAll({
											attributes: ['matchId', 'osuUserId', 'beatmapId'],
											where: {
												gameId: {
													[Op.in]: relatedGames.map((game) => game.gameId),
												},
												[Op.or]: [
													{
														beatmapId: {
															[Op.in]: mapsPlayed.map((map) => map.beatmapId),
														},
													},
													{
														osuUserId: {
															[Op.in]: players,
														},
													},
												],
											},
										});

										let playersInTheOriginalLobby = [...new Set(matchToVerifyScores.map((score) => score.osuUserId))];

										let otherPlayersOutsideOfTheLobbyThatPlayedTheSameMaps = [];
										let otherMatchesWithTheSamePlayers = [];

										for (let i = 0; i < relatedScores.length; i++) {
											let score = relatedScores[i];

											if (score.matchId === match.id) {
												continue;
											}

											let map = mapsPlayed.find((map) => map.beatmapId === score.beatmapId);

											if (map) {
												if (!otherPlayersOutsideOfTheLobbyThatPlayedTheSameMaps.includes(score.osuUserId)) {
													otherPlayersOutsideOfTheLobbyThatPlayedTheSameMaps.push(score.osuUserId);
												}

												map.amount++;
											}

											if (players.includes(score.osuUserId)) {
												let otherMatch = otherMatchesWithTheSamePlayers.find((match) => match.matchId === score.matchId);

												if (!otherMatch) {
													let relatedMatch = relatedMatches.find((match) => match.matchId === score.matchId);

													otherMatchesWithTheSamePlayers.push({ matchId: score.matchId, matchName: relatedMatch.matchName, verifiedAt: relatedMatch.verifiedAt, verifiedBy: relatedMatch.verifiedBy });
												}
											}
										}

										// let playersThatAreOnlyInOtherMatches = otherPlayersOutsideOfTheLobbyThatPlayedTheSameMaps.filter((player) => !playersInTheOriginalLobby.includes(player));

										let qualsMatchOfTheSamePlayers = otherMatchesWithTheSamePlayers.find((match) => match.matchName.toLowerCase().includes('(qualifiers)') || match.matchName.toLowerCase().includes('(qualifier)') || match.matchName.toLowerCase().includes('(quals)') || match.matchName.toLowerCase().includes('(kwalifikacje)'));

										if (matchToVerify.matchName.toLowerCase().includes('(qualifiers)') || matchToVerify.matchName.toLowerCase().includes('(qualifier)') || matchToVerify.matchName.toLowerCase().includes('(quals)') || matchToVerify.matchName.toLowerCase().includes('(kwalifikacje)') || matchToVerify.matchName.toLowerCase().includes('(tryouts)')) {
											if (mapsPlayed.every((map) => map.amount >= 20)) {
												await DBElitebotixOsuMultiMatches.update({
													tourneyMatch: true,
													verifiedAt: new Date(),
													verifiedBy: verificationUser.osuUserId, // Elitebotix
													verificationComment: 'Match reffed by someone else - Qualifiers - All maps played more than 20 times outside of the lobby',
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
													console.log(`Match ${match.id} verified - Match reffed by someone else - Qualifiers - All maps played more than 20 times outside of the lobby`);
												}

												await DBElitebotixProcessQueue.create({
													guildId: 'None',
													task: 'messageChannel',
													additions: `${process.env.VERIFICATIONLOG};\`\`\`diff\n+ Valid: True\nComment: Match reffed by someone else - Qualifiers - All maps played more than 20 times outside of the lobby\`\`\`https://osu.ppy.sh/mp/${match.id} was verified by ${verificationUser.username}#${verificationUser.discriminator} (<@${verificationUser.clientId}> | <https://osu.ppy.sh/users/${verificationUser.osuUserId}>)`,
													priority: 1,
													date: new Date()
												});
											} else {
												await DBElitebotixOsuMultiMatches.update({
													verifiedBy: verificationUser.osuUserId, // Elitebotix
													verificationComment: 'Match reffed by someone else - Qualifiers - Not all maps played more than 20 times outside of the lobby',
													referee: json.events[0].user_id,
												}, {
													where: {
														matchId: match.id,
													},
												});

												if (logVerificationProcess) {
													// eslint-disable-next-line no-console
													console.log(`Match ${match.id} verified - Match reffed by someone else - Qualifiers - Not all maps played more than 20 times outside of the lobby`);
												}
											}
										} else if (otherMatchesWithTheSamePlayers.length && playersInTheOriginalLobby.length > 1) {
											if (qualsMatchOfTheSamePlayers && qualsMatchOfTheSamePlayers.verifiedAt) {
												await DBElitebotixOsuMultiMatches.update({
													tourneyMatch: true,
													verifiedAt: new Date(),
													verifiedBy: verificationUser.osuUserId, // Elitebotix
													verificationComment: 'Match reffed by someone else - Not Qualifiers - The same players played in a Qualifiers match that was verified',
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
													console.log(`Match ${match.id} verified - Match reffed by someone else - Not Qualifiers - The same players played in a Qualifiers match that was verified`);
												}

												await DBElitebotixProcessQueue.create({
													guildId: 'None',
													task: 'messageChannel',
													additions: `${process.env.VERIFICATIONLOG};\`\`\`diff\n+ Valid: True\nComment: Match reffed by someone else - Not Qualifiers - The same players played in a Qualifiers match that was verified\`\`\`https://osu.ppy.sh/mp/${match.id} was verified by ${verificationUser.username}#${verificationUser.discriminator} (<@${verificationUser.clientId}> | <https://osu.ppy.sh/users/${verificationUser.osuUserId}>)`,
													priority: 1,
													date: new Date()
												});
											} else if (qualsMatchOfTheSamePlayers && qualsMatchOfTheSamePlayers.verifiedBy) {
												await DBElitebotixOsuMultiMatches.update({
													verifiedBy: verificationUser.osuUserId, // Elitebotix
													verificationComment: 'Match reffed by someone else - Not Qualifiers - The same players played in a Qualifiers match that could not be verified',
													referee: json.events[0].user_id,
												}, {
													where: {
														matchId: match.id,
													},
												});

												if (logVerificationProcess) {
													// eslint-disable-next-line no-console
													console.log(`Match ${match.id} verified - Match reffed by someone else - Not Qualifiers - The same players played in a Qualifiers match that could not be verified`);
												}
											} else if (qualsMatchOfTheSamePlayers) {
												await DBElitebotixOsuMultiMatches.update({
													verifiedBy: verificationUser.osuUserId, // Elitebotix
													verificationComment: 'Match reffed by someone else - Not Qualifiers - The same players played in a Qualifiers match that was not yet verified',
													referee: json.events[0].user_id,
												}, {
													where: {
														matchId: match.id,
													},
												});

												if (logVerificationProcess) {
													// eslint-disable-next-line no-console
													console.log(`Match ${match.id} verified - Match reffed by someone else - Not Qualifiers - The same players played in a Qualifiers match that was not yet verified`);
												}
											} else if (otherMatchesWithTheSamePlayers.length > 2 && mapsPlayed.some(map => map.amount > 20)) {
												await DBElitebotixOsuMultiMatches.update({
													tourneyMatch: true,
													verifiedAt: new Date(),
													verifiedBy: verificationUser.osuUserId, // Elitebotix
													verificationComment: 'Match reffed by someone else - Not Qualifiers - No quals match of the same players - more than 2 matches by the same players - some maps played more than 20 times in other matches of the same acronym',
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
													console.log(`Match ${match.id} verified - Match reffed by someone else - Not Qualifiers - No quals match of the same players - more than 2 matches by the same players - some maps played more than 20 times in other matches of the same acronym`);
												}

												await DBElitebotixProcessQueue.create({
													guildId: 'None',
													task: 'messageChannel',
													additions: `${process.env.VERIFICATIONLOG};\`\`\`diff\n+ Valid: True\nComment: Match reffed by someone else - Not Qualifiers - No quals match of the same players - more than 2 matches by the same players - some maps played more than 20 times in other matches of the same acronym\`\`\`https://osu.ppy.sh/mp/${match.id} was verified by ${verificationUser.username}#${verificationUser.discriminator} (<@${verificationUser.clientId}> | <https://osu.ppy.sh/users/${verificationUser.osuUserId}>)`,
													priority: 1,
													date: new Date()
												});
											} else if (otherMatchesWithTheSamePlayers.length > 4 && mapsPlayed.some(map => map.amount > 15)) {
												await DBElitebotixOsuMultiMatches.update({
													tourneyMatch: true,
													verifiedAt: new Date(),
													verifiedBy: verificationUser.osuUserId, // Elitebotix
													verificationComment: 'Match reffed by someone else - Not Qualifiers - No quals match of the same players - more than 4 matches by the same players - some maps played more than 15 times in other matches of the same acronym',
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
													console.log(`Match ${match.id} verified - Match reffed by someone else - Not Qualifiers - No quals match of the same players - more than 4 matches by the same players - some maps played more than 15 times in other matches of the same acronym`);
												}

												await DBElitebotixProcessQueue.create({
													guildId: 'None',
													task: 'messageChannel',
													additions: `${process.env.VERIFICATIONLOG};\`\`\`diff\n+ Valid: True\nComment: Match reffed by someone else - Not Qualifiers - No quals match of the same players - more than 4 matches by the same players - some maps played more than 15 times in other matches of the same acronym\`\`\`https://osu.ppy.sh/mp/${match.id} was verified by ${verificationUser.username}#${verificationUser.discriminator} (<@${verificationUser.clientId}> | <https://osu.ppy.sh/users/${verificationUser.osuUserId}>)`,
													priority: 1,
													date: new Date()
												});
											} else if (otherMatchesWithTheSamePlayers.length > 6 && mapsPlayed.some(map => map.amount > 10)) {
												await DBElitebotixOsuMultiMatches.update({
													tourneyMatch: true,
													verifiedAt: new Date(),
													verifiedBy: verificationUser.osuUserId, // Elitebotix
													verificationComment: 'Match reffed by someone else - Not Qualifiers - No quals match of the same players - more than 6 matches by the same players - some maps played more than 10 times in other matches of the same acronym',
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
													console.log(`Match ${match.id} verified - Match reffed by someone else - Not Qualifiers - No quals match of the same players - more than 6 matches by the same players - some maps played more than 10 times in other matches of the same acronym`);
												}

												await DBElitebotixProcessQueue.create({
													guildId: 'None',
													task: 'messageChannel',
													additions: `${process.env.VERIFICATIONLOG};\`\`\`diff\n+ Valid: True\nComment: Match reffed by someone else - Not Qualifiers - No quals match of the same players - more than 6 matches by the same players - some maps played more than 10 times in other matches of the same acronym\`\`\`https://osu.ppy.sh/mp/${match.id} was verified by ${verificationUser.username}#${verificationUser.discriminator} (<@${verificationUser.clientId}> | <https://osu.ppy.sh/users/${verificationUser.osuUserId}>)`,
													priority: 1,
													date: new Date()
												});
											} else if (otherMatchesWithTheSamePlayers.length > 8 && mapsPlayed.some(map => map.amount > 5)) {
												await DBElitebotixOsuMultiMatches.update({
													tourneyMatch: true,
													verifiedAt: new Date(),
													verifiedBy: verificationUser.osuUserId, // Elitebotix
													verificationComment: 'Match reffed by someone else - Not Qualifiers - No quals match of the same players - more than 8 matches by the same players - some maps played more than 5 times in other matches of the same acronym',
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
													console.log(`Match ${match.id} verified - Match reffed by someone else - Not Qualifiers - No quals match of the same players - more than 8 matches by the same players - some maps played more than 5 times in other matches of the same acronym`);
												}

												await DBElitebotixProcessQueue.create({
													guildId: 'None',
													task: 'messageChannel',
													additions: `${process.env.VERIFICATIONLOG};\`\`\`diff\n+ Valid: True\nComment: Match reffed by someone else - Not Qualifiers - No quals match of the same players - more than 8 matches by the same players - some maps played more than 5 times in other matches of the same acronym\`\`\`https://osu.ppy.sh/mp/${match.id} was verified by ${verificationUser.username}#${verificationUser.discriminator} (<@${verificationUser.clientId}> | <https://osu.ppy.sh/users/${verificationUser.osuUserId}>)`,
													priority: 1,
													date: new Date()
												});
											} else {
												await DBElitebotixOsuMultiMatches.update({
													verifiedBy: verificationUser.osuUserId, // Elitebotix
													verificationComment: 'Match reffed by someone else - Not Qualifiers - No quals match of the same players - not verifyable',
													referee: json.events[0].user_id,
												}, {
													where: {
														matchId: match.id,
													},
												});

												if (logVerificationProcess) {
													// eslint-disable-next-line no-console
													console.log(`Match ${match.id} verified - Match reffed by someone else - Not Qualifiers - No quals match of the same players - not verifyable`);
												}
											}
										} else {
											await DBElitebotixOsuMultiMatches.update({
												verifiedBy: verificationUser.osuUserId, // Elitebotix
												verificationComment: 'Match reffed by someone else - Verification status not determinable',
												referee: json.events[0].user_id,
											}, {
												where: {
													matchId: match.id,
												},
											});

											if (logVerificationProcess) {
												// eslint-disable-next-line no-console
												console.log(`Match ${match.id} verified - Match reffed by someone else - Verification status not determinable`);
											}
										}
									}
								} else {
									await DBElitebotixOsuMultiMatches.update({
										verifiedBy: verificationUser.osuUserId, // Elitebotix
										verificationComment: 'Not determinable who created the match',
									}, {
										where: {
											matchId: match.id,
										},
									});

									if (logVerificationProcess) {
										// eslint-disable-next-line no-console
										console.log(`Match ${match.id} verified - Not determinable who created the match`);
									}
								}
							}
						});
				} catch (e) {
					if (!e.message.endsWith('reason: Client network socket disconnected before secure TLS connection was established')
						&& !e.message.endsWith('reason: read ECONNRESET')) {
						console.error(e);
					}
					// Go same if error
					return true;
				}
			})
			.catch(async (err) => {
				if (err.message === 'Not found') {
					//If its not found anymore it should be fake because it must be created in a different way
					await DBElitebotixOsuMultiMatches.update({
						verifiedBy: verificationUser.osuUserId, // Elitebotix
						verificationComment: 'match not found - can\'t be determined if fake or not',
						referee: -1,
					}, {
						where: {
							matchId: matchToVerify.matchId,
						},
					});

					if (logVerificationProcess) {
						// eslint-disable-next-line no-console
						console.log(`Match ${matchToVerify.matchId} verified - match not found - can't be determined if fake or not`);
					}
				} else {
					// Go same if error
					console.error(err);
					return true;
				}
			});

		await new Promise(resolve => setTimeout(resolve, 1 * 60 * 1000));
		return;
	}
};
