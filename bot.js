const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const bodyParser = require('body-parser');
const Discord = require('discord.js');
const config = require('./config.json');
const { Client, Intents } = require('discord.js');

const myIntents = new Intents([Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES]);

const bot = new Client({ intents: myIntents });
bot.login(config.botToken);

function sendDiscordMessage(payload, serverName, eventType) {
  const channel = bot.channels.cache.get(config.Discord_Channel_ID);
  if (!channel) return;

  const action = eventType === 'user.join' ? 'Join' : 'Leave';
  const title = `Watchlist player ${action} on ${serverName}`;
  const color = eventType === 'user.join' ? 'GREEN' : 'RED';
  
   // Find the watchlist entry for this cftools_id
  const watchlistEntry = watchlist.find(w => w.id === payload.cftools_id);


  const embed = new Discord.MessageEmbed()
    .setTitle(title)
    .setURL(`https://app.cftools.cloud/profile/${payload.cftools_id}`)
    .setColor(color)
    .addFields(
      { name: 'Player Name', value: `\`${payload.player_name}\`` },
      { name: 'CF-ID', value: `\`${payload.cftools_id}\`` }
    );

  if (eventType === 'user.join') {
    embed.addFields(
      { name: 'Country', value: `\`${payload.player_country}\`` },
      { name: 'IP', value: `\`${payload.player_ipv4}\`` },
      { name: 'GUID', value: `\`${payload.player_guid}\`` },
      { name: 'Steam64', value: `\`${payload.player_steam64}\`` },
	  { name: 'Reason', value: `\`${watchlistEntry ? watchlistEntry.description : 'No description provided'}\`` } // Include the description
    );
  } else if (eventType === 'user.leave') {
    embed.addField('Playtime', `\`${payload.player_playtime || 'Unknown'}\``);
  }

  const messageOptions = { embeds: [embed] };

  if (eventType === 'user.join' && config.pingRoleID) {
    messageOptions.content = `<@&${config.pingRoleID}>`;
  }

  channel.send(messageOptions);
}

// Load Watchlist
let watchlist = [];
const watchlistPath = 'watchlist.txt';

if (fs.existsSync(watchlistPath)) {
  const fileContent = fs.readFileSync(watchlistPath, 'utf-8');
  watchlist = fileContent.split('\n').filter(line => line.trim() !== '').map(line => {
    const [id, ...descParts] = line.split(' ');
    return { id, description: descParts.join(' ') };
  });
} else {
  fs.writeFileSync(watchlistPath, '');
}

Object.entries(config.servers).forEach(([serverName, serverConfig]) => {
  const app = express();
  app.use(bodyParser.json());

  app.post('/', async function(req, res) {
    const {
        'x-hephaistos-signature': signature,
        'x-hephaistos-delivery': deliveryId,
        'x-hephaistos-event': eventType,
    } = req.headers;

    if (eventType === 'verification') {
        res.status(204).end();
        return;
    }

    const hash = crypto.createHash('sha256');
	const serverConfig = config.servers[serverName];
	hash.update(`${deliveryId}${serverConfig.secret}`, 'utf8');
    const localSignature = hash.digest('hex');

    if (localSignature !== signature) {
        console.log('Signature mismatch');
        res.status(401).end();
        return;
    }

    // Check cftools_id with entries in Watchlist
    const cftools_id = req.body.cftools_id;
	if (watchlist.some(entry => entry.id === cftools_id)) {
	  // Send Discord message
	  sendDiscordMessage(req.body, serverName, eventType);
	}

    res.status(204).end();
  });

  app.listen(serverConfig.port, function() {
    console.log(`Server ${serverName} started on port ${serverConfig.port}`);
  });
});

bot.on('messageCreate', (message) => {
  if (message.author.bot || !message.content.startsWith(config.prefix)) return;

  const args = message.content.slice(config.prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

	if (command === 'add') {
	  const cftools_id = args[0];
	  const description = args.slice(1).join(' '); // Get the rest of the arguments as the description
	  if (/^[a-fA-F0-9]{24}$/.test(cftools_id)) {
		const entry = { id: cftools_id, description }; // Save as an object
		if (!watchlist.some(w => w.id === cftools_id)) { // Check using the id
		  watchlist.push(entry);
		  fs.appendFileSync(watchlistPath, cftools_id + ' ' + description + '\n'); // Save with description
		  message.reply(`ID ${cftools_id} was added to Watchlist`);
		} else {
		  message.reply(`ID ${cftools_id} is already in Watchlist`);
		}
	  } else {
		message.reply('Invalid CFTools-ID.');
	  }
	}

	if (command === 'remove') {
	  const cftools_id = args[0];
	  const index = watchlist.findIndex(w => w.id === cftools_id);
	  if (index > -1) {
		watchlist.splice(index, 1);
		fs.writeFileSync(watchlistPath, watchlist.map(w => w.id + ' ' + w.description).join('\n') + '\n');
		message.reply(`ID ${cftools_id} was removed from Watchlist`);
	  } else {
		message.reply('ID was not found in Watchlist!');
	  }
	}

	if (command === 'list') {
	  const listString = watchlist.map(entry => `${entry.id} - ${entry.description}`).join('\n');
	  const embed = new Discord.MessageEmbed()
		.setTitle('Watchlist')
		.setDescription('```' + listString + '```');
	  message.channel.send({ embeds: [embed] });
	}
});
