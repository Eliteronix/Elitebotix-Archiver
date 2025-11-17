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

// Export everything you need
module.exports = {
	client,
	register,
	timeBehindMatchCreation,
	incompleteGameScoreCount,
	verifyMatchesCount,
	refereeMatchesCount
};