require('dotenv').config();

module.exports = {
	name: "Elitebotix Archiver", // Name of your application
	script: "index.js", // Entry point of your application
	interpreter: "bun", // Bun interpreter
	watch: true, // Watch for file changes
	ignore_watch: [
		"databases",
		".git",
		"maps",
		"package-lock.json",
		"matchLogs",
		"node_modules",
		"listcovers",
		"beatmapcovers",
		"badges",
		"slimcovers",
		"avatars",
		"wrappedcards",
	],
	env: {
		PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}`, // Add "~/.bun/bin/bun" to PATH
	}
};