require('dotenv').config();

module.exports = {
	name: "Elitebotix Archiver", // Name of your application
	script: "index.js", // Entry point of your application
	interpreter: "bun", // Bun interpreter
	watch: returnBoolean(process.env.SERVER), // Watch for file changes
	ignore_watch: [
		"lastImport.json",
		".git"
	],
	env: {
		PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}`, // Add "~/.bun/bin/bun" to PATH
	}
};

function returnBoolean(value) {
	if (value === "Live") return false;
	if (value === "Dev") return true;
	return value;
}