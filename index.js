//Log message upon starting the bot
// eslint-disable-next-line no-console
console.log('Bot is starting...');

require('dotenv').config();

//require the discord.js module
const Discord = require('discord.js');

//create a Discord client with discord.js
const client = new Discord.Client({
	intents: [
		Discord.GatewayIntentBits.MessageContent,
		Discord.GatewayIntentBits.GuildMessages,
		Discord.GatewayIntentBits.GuildMessageReactions,
		Discord.GatewayIntentBits.DirectMessages,
		Discord.GatewayIntentBits.DirectMessageReactions,
		Discord.GatewayIntentBits.Guilds,
		Discord.GatewayIntentBits.GuildMembers,
		Discord.GatewayIntentBits.GuildVoiceStates,
	],
	partials: [
		Discord.Partials.Channel,
	]
});

//login with the Discord client using the Token from the .env file
// eslint-disable-next-line no-undef
client.login(process.env.BOTTOKEN);

//declare what the discord client should do when it's ready
client.on('ready', readyDiscord);

//declare the function which will be used when ready
async function readyDiscord() {
	//log a message when ready
	// eslint-disable-next-line no-console
	console.log('The Bot is ready.');

	client.user.setPresence({
		status: 'online',  //You can show online, idle....
		activities: [{
			name: 'with Elitebotix',  //The message shown
			// type: 'PLAYING' //PLAYING: WATCHING: LISTENING: STREAMING:
		}]
	});
}