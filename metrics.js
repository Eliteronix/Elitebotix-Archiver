const client = require('prom-client');

// Create a Registry which registers the metrics
const register = new client.Registry();

// Add default labels to all metrics
register.setDefaultLabels({
	app: 'elitebotix-archiver'
});

// Enable default Node.js metrics
client.collectDefaultMetrics({ register });

// Define metrics
const osuApiRequests = new client.Counter({
	name: 'osu_api_requests',
	help: 'osu! API requests',
});
register.registerMetric(osuApiRequests);

const osuWebRequests = new client.Counter({
	name: 'osu_web_requests',
	help: 'osu! web requests',
});
register.registerMetric(osuWebRequests);

const timeBehindMatchCreation = new client.Gauge({
	name: 'time_behind_match_creation',
	help: 'The time behind match creation in seconds',
});
register.registerMetric(timeBehindMatchCreation);

const incompleteGameScoreCount = new client.Gauge({
	name: 'incomplete_game_score_count',
	help: 'Incomplete game score count',
});
register.registerMetric(incompleteGameScoreCount);

const verifyMatchesCount = new client.Gauge({
	name: 'verify_matches_count',
	help: 'Verify matches count',
});
register.registerMetric(verifyMatchesCount);

const refereeMatchesCount = new client.Gauge({
	name: 'referee_matches_count',
	help: 'Referee matches count',
});
register.registerMetric(refereeMatchesCount);

const processQueueAccesses = new client.Gauge({
	name: 'database_elitebotix_processQueue',
	help: 'Database elitebotix-processQueue accessed',
});
register.registerMetric(processQueueAccesses);

const multiGameScoresAccesses = new client.Gauge({
	name: 'database_multiGameScores',
	help: 'Database multiGameScores accessed',
});
register.registerMetric(multiGameScoresAccesses);

const multiGamesAccesses = new client.Gauge({
	name: 'database_multiGames',
	help: 'Database multiGames accessed',
});
register.registerMetric(multiGamesAccesses);

const multiMatchesAccesses = new client.Gauge({
	name: 'database_multiMatches',
	help: 'Database multiMatches accessed',
});
register.registerMetric(multiMatchesAccesses);

// Export everything you need
module.exports = {
	client,
	register,
	timeBehindMatchCreation,
	incompleteGameScoreCount,
	verifyMatchesCount,
	refereeMatchesCount,
	osuApiRequests,
	osuWebRequests,
	processQueueAccesses,
	multiGameScoresAccesses,
	multiGamesAccesses,
	multiMatchesAccesses,
};