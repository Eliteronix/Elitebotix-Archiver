const { DBOsuMultiMatches, DBOsuMultiGames, DBOsuMultiGameScores } = require('../dbObjects');
const { logDatabaseQueries, awaitWebRequestPermission, logOsuAPICalls, sendMessageToLogChannel } = require('../utils');
const { Op } = require('sequelize');

async function verifyAnyMatch(osuApi, client, logVerificationProcess) {
	logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiMatches find match to verify referee backup');
	matchToVerify = await DBOsuMultiMatches.findOne({
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
		logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiMatches find match to verify backup');
		matchToVerify = await DBOsuMultiMatches.findOne({
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

		return;
		//return await addMissingRefereeInfo(osuApi, client);
	}

	if (matchToVerify.matchName.startsWith('ETX') || matchToVerify.matchName.startsWith('o!mm') || matchToVerify.matchName.startsWith('ROMAI')) {
		logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiMatches Last step of verification - ETX, o!mm or ROMAI not verifyable');
		await DBOsuMultiMatches.update({
			verifiedBy: 31050083, // Elitebotix
			verificationComment: 'Last step of verification - ETX, o!mm or ROMAI not verifyable',
		}, {
			where: {
				matchId: matchToVerify.matchId,
			},
		});

		if (logVerificationProcess) {
			// eslint-disable-next-line no-console
			console.log(`Match ${matchToVerify.matchId} verified - Last step of verification - ETX, o!mm or ROMAI not verifyable`);
		}
		return;
	}

	process.send('osu! API');
	return await osuApi.getMatch({ mp: matchToVerify.matchId })
		.then(async (match) => {
			try {
				await awaitWebRequestPermission(`https://osu.ppy.sh/community/matches/${match.id}`, client);
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

								await awaitWebRequestPermission(`https://osu.ppy.sh/community/matches/${match.id}?before=${json.events[0].id}&limit=100`, client);
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
								logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiGameScores Find a score by the match creator');
								let scores = await DBOsuMultiGameScores.findAll({
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
									logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiMatches Match creator played a round - Not determined if valid');
									await DBOsuMultiMatches.update({
										verifiedBy: 31050083, // Elitebotix
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
									logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiGameScores Match creator did not play a round - Not determined if valid');
									let matchToVerifyScores = await DBOsuMultiGameScores.findAll({
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

									logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiMatches Match creator did not play a round');
									let relatedMatches = await DBOsuMultiMatches.findAll({
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

									logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiGames Match creator did not play a round');
									let relatedGames = await DBOsuMultiGames.findAll({
										attributes: ['gameId'],
										where: {
											matchId: {
												[Op.in]: relatedMatches.map((match) => match.matchId),
											},
											warmup: false,
										},
									});

									logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiGameScores Match creator did not play a round');
									let relatedScores = await DBOsuMultiGameScores.findAll({
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
											logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiMatches update Qualifiers all maps played more than 20 times');
											await DBOsuMultiMatches.update({
												tourneyMatch: true,
												verifiedAt: new Date(),
												verifiedBy: 31050083, // Elitebotix
												verificationComment: 'Match reffed by someone else - Qualifiers - All maps played more than 20 times outside of the lobby',
												referee: json.events[0].user_id,
											}, {
												where: {
													matchId: match.id,
												},
											});

											logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiGames update Qualifiers all maps played more than 20 times');
											await DBOsuMultiGames.update({
												tourneyMatch: true,
											}, {
												where: {
													matchId: match.id,
												},
											});

											logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiGameScores update Qualifiers all maps played more than 20 times');
											await DBOsuMultiGameScores.update({
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

											await sendMessageToLogChannel(client, process.env.VERIFICATIONLOG, `\`\`\`diff\n+ Valid: True\nComment: Match reffed by someone else - Qualifiers - All maps played more than 20 times outside of the lobby\`\`\`https://osu.ppy.sh/mp/${match.id} was verified by ${client.user.username}#${client.user.discriminator} (<@${client.user.id}> | <https://osu.ppy.sh/users/31050083>)`);
										} else {
											logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiMatches update Qualifiers not all maps played more than 20 times');
											await DBOsuMultiMatches.update({
												verifiedBy: 31050083, // Elitebotix
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
											logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiMatches update Match reffed by someone else - Not Qualifiers - The same players played in a Qualifiers match that was verified');
											await DBOsuMultiMatches.update({
												tourneyMatch: true,
												verifiedAt: new Date(),
												verifiedBy: 31050083, // Elitebotix
												verificationComment: 'Match reffed by someone else - Not Qualifiers - The same players played in a Qualifiers match that was verified',
												referee: json.events[0].user_id,
											}, {
												where: {
													matchId: match.id,
												},
											});

											logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiGames update Match reffed by someone else - Not Qualifiers - The same players played in a Qualifiers match that was verified');
											await DBOsuMultiGames.update({
												tourneyMatch: true,
											}, {
												where: {
													matchId: match.id,
												},
											});

											logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiGameScores update Match reffed by someone else - Not Qualifiers - The same players played in a Qualifiers match that was verified');
											await DBOsuMultiGameScores.update({
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

											await sendMessageToLogChannel(client, process.env.VERIFICATIONLOG, `\`\`\`diff\n+ Valid: True\nComment: Match reffed by someone else - Not Qualifiers - The same players played in a Qualifiers match that was verified\`\`\`https://osu.ppy.sh/mp/${match.id} was verified by ${client.user.username}#${client.user.discriminator} (<@${client.user.id}> | <https://osu.ppy.sh/users/31050083>)`);
										} else if (qualsMatchOfTheSamePlayers && qualsMatchOfTheSamePlayers.verifiedBy) {
											logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiMatches update Match reffed by someone else - Not Qualifiers - The same players played in a Qualifiers match that could not be verified');
											await DBOsuMultiMatches.update({
												verifiedBy: 31050083, // Elitebotix
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
											logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiMatches update Match reffed by someone else - Not Qualifiers - The same players played in a Qualifiers match that was not yet verified');
											await DBOsuMultiMatches.update({
												verifiedBy: 31050083, // Elitebotix
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
											logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiMatches update Match reffed by someone else - Not Qualifiers - No quals match of the same players - more than 2 matches by the same players - some maps played more than 20 times in other matches of the same acronym');
											await DBOsuMultiMatches.update({
												tourneyMatch: true,
												verifiedAt: new Date(),
												verifiedBy: 31050083, // Elitebotix
												verificationComment: 'Match reffed by someone else - Not Qualifiers - No quals match of the same players - more than 2 matches by the same players - some maps played more than 20 times in other matches of the same acronym',
												referee: json.events[0].user_id,
											}, {
												where: {
													matchId: match.id,
												},
											});

											logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiGames update Match reffed by someone else - Not Qualifiers - No quals match of the same players - more than 2 matches by the same players - some maps played more than 20 times in other matches of the same acronym');
											await DBOsuMultiGames.update({
												tourneyMatch: true,
											}, {
												where: {
													matchId: match.id,
												},
											});

											logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiGameScores update Match reffed by someone else - Not Qualifiers - No quals match of the same players - more than 2 matches by the same players - some maps played more than 20 times in other matches of the same acronym');
											await DBOsuMultiGameScores.update({
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

											await sendMessageToLogChannel(client, process.env.VERIFICATIONLOG, `\`\`\`diff\n+ Valid: True\nComment: Match reffed by someone else - Not Qualifiers - No quals match of the same players - more than 2 matches by the same players - some maps played more than 20 times in other matches of the same acronym\`\`\`https://osu.ppy.sh/mp/${match.id} was verified by ${client.user.username}#${client.user.discriminator} (<@${client.user.id}> | <https://osu.ppy.sh/users/31050083>)`);
										} else if (otherMatchesWithTheSamePlayers.length > 4 && mapsPlayed.some(map => map.amount > 15)) {
											logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiMatches update Match reffed by someone else - Not Qualifiers - No quals match of the same players - more than 4 matches by the same players - some maps played more than 15 times in other matches of the same acronym');
											await DBOsuMultiMatches.update({
												tourneyMatch: true,
												verifiedAt: new Date(),
												verifiedBy: 31050083, // Elitebotix
												verificationComment: 'Match reffed by someone else - Not Qualifiers - No quals match of the same players - more than 4 matches by the same players - some maps played more than 15 times in other matches of the same acronym',
												referee: json.events[0].user_id,
											}, {
												where: {
													matchId: match.id,
												},
											});

											logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiGames update Match reffed by someone else - Not Qualifiers - No quals match of the same players - more than 4 matches by the same players - some maps played more than 15 times in other matches of the same acronym');
											await DBOsuMultiGames.update({
												tourneyMatch: true,
											}, {
												where: {
													matchId: match.id,
												},
											});

											logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiGameScores update Match reffed by someone else - Not Qualifiers - No quals match of the same players - more than 4 matches by the same players - some maps played more than 15 times in other matches of the same acronym');
											await DBOsuMultiGameScores.update({
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

											await sendMessageToLogChannel(client, process.env.VERIFICATIONLOG, `\`\`\`diff\n+ Valid: True\nComment: Match reffed by someone else - Not Qualifiers - No quals match of the same players - more than 4 matches by the same players - some maps played more than 15 times in other matches of the same acronym\`\`\`https://osu.ppy.sh/mp/${match.id} was verified by ${client.user.username}#${client.user.discriminator} (<@${client.user.id}> | <https://osu.ppy.sh/users/31050083>)`);
										} else if (otherMatchesWithTheSamePlayers.length > 6 && mapsPlayed.some(map => map.amount > 10)) {
											logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiMatches update Match reffed by someone else - Not Qualifiers - No quals match of the same players - more than 6 matches by the same players - some maps played more than 10 times in other matches of the same acronym');
											await DBOsuMultiMatches.update({
												tourneyMatch: true,
												verifiedAt: new Date(),
												verifiedBy: 31050083, // Elitebotix
												verificationComment: 'Match reffed by someone else - Not Qualifiers - No quals match of the same players - more than 6 matches by the same players - some maps played more than 10 times in other matches of the same acronym',
												referee: json.events[0].user_id,
											}, {
												where: {
													matchId: match.id,
												},
											});

											logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiGames update Match reffed by someone else - Not Qualifiers - No quals match of the same players - more than 6 matches by the same players - some maps played more than 10 times in other matches of the same acronym');
											await DBOsuMultiGames.update({
												tourneyMatch: true,
											}, {
												where: {
													matchId: match.id,
												},
											});

											logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiGameScores update Match reffed by someone else - Not Qualifiers - No quals match of the same players - more than 6 matches by the same players - some maps played more than 10 times in other matches of the same acronym');
											await DBOsuMultiGameScores.update({
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

											await sendMessageToLogChannel(client, process.env.VERIFICATIONLOG, `\`\`\`diff\n+ Valid: True\nComment: Match reffed by someone else - Not Qualifiers - No quals match of the same players - more than 6 matches by the same players - some maps played more than 10 times in other matches of the same acronym\`\`\`https://osu.ppy.sh/mp/${match.id} was verified by ${client.user.username}#${client.user.discriminator} (<@${client.user.id}> | <https://osu.ppy.sh/users/31050083>)`);
										} else if (otherMatchesWithTheSamePlayers.length > 8 && mapsPlayed.some(map => map.amount > 5)) {
											logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiMatches update Match reffed by someone else - Not Qualifiers - No quals match of the same players - more than 8 matches by the same players - some maps played more than 5 times in other matches of the same acronym');
											await DBOsuMultiMatches.update({
												tourneyMatch: true,
												verifiedAt: new Date(),
												verifiedBy: 31050083, // Elitebotix
												verificationComment: 'Match reffed by someone else - Not Qualifiers - No quals match of the same players - more than 8 matches by the same players - some maps played more than 5 times in other matches of the same acronym',
												referee: json.events[0].user_id,
											}, {
												where: {
													matchId: match.id,
												},
											});

											logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiGames update Match reffed by someone else - Not Qualifiers - No quals match of the same players - more than 8 matches by the same players - some maps played more than 5 times in other matches of the same acronym');
											await DBOsuMultiGames.update({
												tourneyMatch: true,
											}, {
												where: {
													matchId: match.id,
												},
											});

											logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiGameScores update Match reffed by someone else - Not Qualifiers - No quals match of the same players - more than 8 matches by the same players - some maps played more than 5 times in other matches of the same acronym');
											await DBOsuMultiGameScores.update({
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

											await sendMessageToLogChannel(client, process.env.VERIFICATIONLOG, `\`\`\`diff\n+ Valid: True\nComment: Match reffed by someone else - Not Qualifiers - No quals match of the same players - more than 8 matches by the same players - some maps played more than 5 times in other matches of the same acronym\`\`\`https://osu.ppy.sh/mp/${match.id} was verified by ${client.user.username}#${client.user.discriminator} (<@${client.user.id}> | <https://osu.ppy.sh/users/31050083>)`);
										} else {
											logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiMatches update No quals match of the same players - not verifyable');
											await DBOsuMultiMatches.update({
												verifiedBy: 31050083, // Elitebotix
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
										logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiMatches verification status not determinable');
										await DBOsuMultiMatches.update({
											verifiedBy: 31050083, // Elitebotix
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
								logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiMatches update not determinable maidbot match');
								await DBOsuMultiMatches.update({
									verifiedBy: 31050083, // Elitebotix
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
				//Increase seconds to wait
				return true;
			}
		})
		.catch(async (err) => {
			if (err.message === 'Not found') {
				//If its not found anymore it should be fake because it must be created in a different way
				logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiMatches update fake maidbot match');
				await DBOsuMultiMatches.update({
					verifiedBy: 31050083, // Elitebotix
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
				//Increase seconds to wait
				return true;
			}
		});
}

async function addMissingRefereeInfo(osuApi, client) {
	logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiMatches refereeInfoMissing');
	let refereeInfoMissing = await DBOsuMultiMatches.findOne({
		attributes: ['matchId'],
		where: {
			tourneyMatch: true,
			verifiedBy: {
				[Op.not]: null,
			},
			referee: null,
		},
		order: [
			['matchId', 'ASC'],
		],
	});

	if (!refereeInfoMissing) {
		client.shard.broadcastEval(async (c, { message }) => {
			let channel;
			if (process.env.SERVER === 'Live') {
				channel = await c.channels.cache.get('1212871483152400385');
			} else {
				channel = await c.channels.cache.get('1212871419998904420');
			}

			if (channel) {
				await channel.send(message);
			}
		}, { context: { message: 'No match to get referee info for' } });

		//Increase seconds to wait
		return true;
	}

	logOsuAPICalls('processQueueTasks/saveMultiMatches.js refereeInfoMissing');
	return await osuApi.getMatch({ mp: refereeInfoMissing.matchId })
		.then(async (match) => {
			try {
				await awaitWebRequestPermission(`https://osu.ppy.sh/community/matches/${match.id}`, client);
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

							while (json.first_event_id !== json.events[0].id) {
								await awaitWebRequestPermission(`https://osu.ppy.sh/community/matches/${match.id}?before=${json.events[0].id}&limit=100`, client);
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

										regexMatch = null;

										return json.events;
									});

								json.events = earlierEvents.concat(json.events);
							}

							if (json.events[0].detail.type === 'match-created') {
								// Don't ask me how but for some reason the user_id can be null?????
								if (json.events[0].user_id) {
									logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiMatches update referee');
									await DBOsuMultiMatches.update({
										referee: json.events[0].user_id,
									}, {
										where: {
											matchId: match.id,
										},
									});

									client.shard.broadcastEval(async (c, { message }) => {
										let channel;
										if (process.env.SERVER === 'Live') {
											channel = await c.channels.cache.get('1212871483152400385');
										} else {
											channel = await c.channels.cache.get('1212871419998904420');
										}

										if (channel) {
											await channel.send(message);
										}
									}, { context: { message: `Match https://osu.ppy.sh/community/matches/${refereeInfoMissing.matchId} reffed by https://osu.ppy.sh/users/${json.events[0].user_id}` } });
								} else {
									logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiMatches update referee is null');
									await DBOsuMultiMatches.update({
										referee: -1,
									}, {
										where: {
											matchId: refereeInfoMissing.matchId,
										},
									});

									client.shard.broadcastEval(async (c, { message }) => {
										let channel;
										if (process.env.SERVER === 'Live') {
											channel = await c.channels.cache.get('1212871483152400385');
										} else {
											channel = await c.channels.cache.get('1212871419998904420');
										}

										if (channel) {
											await channel.send(message);
										}
									}, { context: { message: `Referee is null https://osu.ppy.sh/community/matches/${refereeInfoMissing.matchId}` } });
								}
							} else {
								logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiMatches update unavailable match start referee 2');
								await DBOsuMultiMatches.update({
									referee: -1,
								}, {
									where: {
										matchId: refereeInfoMissing.matchId,
									},
								});

								client.shard.broadcastEval(async (c, { message }) => {
									let channel;
									if (process.env.SERVER === 'Live') {
										channel = await c.channels.cache.get('1212871483152400385');
									} else {
										channel = await c.channels.cache.get('1212871419998904420');
									}

									if (channel) {
										await channel.send(message);
									}
								}, { context: { message: `Match start https://osu.ppy.sh/community/matches/${refereeInfoMissing.matchId} unavailable` } });
							}
						}
					});
			} catch (e) {
				if (!e.message.endsWith('reason: Client network socket disconnected before secure TLS connection was established')
					&& !e.message.endsWith('reason: read ECONNRESET')) {
					console.error(e);
				}
				// Go same if error
				//Increase seconds to wait
				return true;
			}
		})
		.catch(async (err) => {
			if (err.message === 'Not found') {
				logDatabaseQueries(2, 'processQueueTasks/saveMultiMatches.js DBOsuMultiMatches update unavailable match referee 2');
				await DBOsuMultiMatches.update({
					referee: -1,
				}, {
					where: {
						matchId: refereeInfoMissing.matchId,
					},
				});

				client.shard.broadcastEval(async (c, { message }) => {
					let channel;
					if (process.env.SERVER === 'Live') {
						channel = await c.channels.cache.get('1212871483152400385');
					} else {
						channel = await c.channels.cache.get('1212871419998904420');
					}

					if (channel) {
						await channel.send(message);
					}
				}, { context: { message: `Match https://osu.ppy.sh/community/matches/${refereeInfoMissing.matchId} unavailable` } });

				return false;
			} else {
				// Go same if error
				//Increase seconds to wait
				return true;
			}
		});
}