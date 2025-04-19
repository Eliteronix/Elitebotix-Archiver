module.exports = {
	async processIncompleteScores() {
		console.log('processIncompleteScores.js | processIncompleteScores');
		//Return after 1 minutes
		await new Promise(resolve => setTimeout(resolve, 1 * 60 * 1000));
		return;
	}
};
