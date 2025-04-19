require('dotenv').config();

module.exports = {
	name: "Elitebotix Archiver", // Name of your application
	script: "index.js", // Entry point of your application
	interpreter: "bun", // Bun interpreter
	watch: true, // Watch for file changes
	ignore_watch: [
		"lastImport.json",
	],
	env: {
		PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}`, // Add "~/.bun/bin/bun" to PATH
	}
};