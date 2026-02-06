const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

client.on('ready', () => {
  console.log(`${client.user.tag} is now running!`);
});

client.on('messageCreate', (message) => {
  // Ignore bot messages
  if (message.author.bot) return;

  if (message.content === '!ping') {
    message.reply('Pong!');
  }

  if (message.content === '!hello') {
    message.reply(`Hello, ${message.author.username}! 👋`);
  }
});

client.login(process.env.DISCORD_TOKEN);
