module.exports = {
	async verifyMatches() {
		console.log('Verifying matches...');
		await new Promise(resolve => setTimeout(resolve, 1 * 60 * 1000));
		return;
	}
};
