const { Client, Intents, MessageActionRow, MessageButton, MessageEmbed } = require('discord.js');
const fs = require('fs/promises');
const path = require('path');
const config = require('./config.json');

const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });

let tickets = {};
let blacklist = [];

const prefix = config.prefix;

client.once('ready', () => {
  const readyMessage = config.readyMessage.replace("${client.user.tag}", client.user.tag);
  if (readyMessage) {
    console.log(readyMessage);
  }

  loadTickets();
  loadBlacklist();
});

function createErrorEmbed(title, description, extraMessage) {
  return {
    color: 0xff0000, 
    title: title,
    description: description,
    fields: [
      {
        name: 'Erreur',
        value: extraMessage,
      },
    ],
  };
}

function createSuccessEmbed(title, description) {
  return {
    color: 0x00ff00, 
    title: title,
    description: description,
  };
}

function createErreurEmbed(title, description) {
  return {
    color: 0xff0000,
    title: title,
    description: description,
  };
}

client.on('messageCreate', async (message) => {
  const prefix = config.prefix;
  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === 'add' || command === 'remove') {
    const member = message.member;

    if (!message.member.roles.cache.has(config.commandePermissionRole)) {
        const createErrorEmbed = new MessageEmbed()
            .setColor('#ff0000')
            .setTitle('Erreur de Permission')
            .setDescription("Vous n'avez pas la permission d'utiliser cette commande.")
            .addFields({
                name: 'Erreur',
                value: 'Vous devez avoir le rôle spécifique pour exécuter cette commande.'
            });

        return message.reply({ embeds: [createErreurEmbed] });
    }

    const userId = args.shift();
    if (!userId) {
      return message.reply({ embeds: [createErreurEmbed('Erreur d\'Utilisation', "Veuillez fournir l'ID de l'utilisateur que vous souhaitez ajouter ou retirer.")] });
    }
 
    let user;
    try {
      user = await message.guild.members.fetch(userId);
    } catch (error) {
    
      return message.reply({ embeds: [createErreurEmbed('Erreur d\'Utilisateur', "L'utilisateur spécifié n'a pas été trouvé sur ce serveur.")] });
    }

    const action = command === 'add' ? 'ajouté' : 'retiré';
    const embed = createSuccessEmbed(
      command === 'add' ? 'Utilisateur ajouté au ticket' : 'Utilisateur retiré du ticket',
      `L'utilisateur ${user.user.tag} a été ${action} du ticket.`
    );

    const ticketChannel = message.guild.channels.cache.find(channel => channel.name.startsWith('ticket-') && channel.type === 'GUILD_TEXT' && channel.name.slice('ticket-'.length) === message.author.username);

    if (!ticketChannel) {
      return message.reply({ embeds: [createErreurEmbed('Erreur de Ticket', "Le canal du ticket n'a pas été trouvé.")] });
    }

    try {
      const existingPermission = ticketChannel.permissionOverwrites.cache.get(user.id);
      
      if (command === 'add' && !existingPermission) {
        await ticketChannel.permissionOverwrites.create(user.id, { VIEW_CHANNEL: true });
      } else if (command === 'remove' && existingPermission) {
        await existingPermission.delete();
      }
    } catch (error) {
      console.error(error);
      return message.reply({ embeds: [createErreurEmbed('Erreur de Modification des Autorisations', "Une erreur s'est produite lors de la modification des autorisations du canal.")] });
    }

    message.reply({ embeds: [embed] });
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === 'ticketsetup') {
    if (!message.member.roles.cache.has(config.commandePermissionRole)) {
      return message.reply({
        embeds: [new MessageEmbed()
          .setColor('#ff0000')
          .setTitle('Erreur de Permission')
          .setDescription("Vous n'avez pas la permission d'utiliser cette commande.")
          .addFields({
            name: 'Erreur',
            value: 'Vous devez avoir le rôle spécifique pour exécuter cette commande.'
          })
        ]
      });
    }

    message.delete();

    const row = new MessageActionRow().addComponents(
      new MessageButton().setCustomId('aide').setLabel('❓ | Besoin d\'aide').setStyle('SUCCESS')
    );

    const EmbedOuvrir= config.EmbedOuvrir || {};
    const embedOuvrir = new MessageEmbed()
    .setColor(EmbedOuvrir.color || '')
    .setTitle(EmbedOuvrir.title || '')
    .setDescription(EmbedOuvrir.description || '');

    message.channel.send({ components: [row], embeds: [embedOuvrir] });
  }

  if (command === 'blacklist' || command === 'unblacklist') {
    if (!message.member.roles.cache.has(config.commandePermissionRole)) {
      return message.reply({
        embeds: [new MessageEmbed()
          .setColor('#ff0000')
          .setTitle('Erreur de Permission')
          .setDescription("Vous n'avez pas la permission d'utiliser cette commande.")
          .addFields({
            name: 'Erreur',
            value: 'Vous devez avoir le rôle spécifique pour exécuter cette commande.'
          })
        ]
      });
    }    
  
    const userToModify = args[0];

    if (!userToModify) {
      return message.reply({
        embeds: [new MessageEmbed()
          .setColor('#ff0000')
          .setDescription(`Veuillez spécifier un utilisateur à ${command === 'blacklist' ? 'ajouter à' : 'retirer de'} la liste noire.`)
        ]
      });
    }

    try {
      command === 'blacklist' ? await addToBlacklist(userToModify) : await removeFromBlacklist(userToModify);

      message.reply({
        embeds: [new MessageEmbed()
          .setColor('#00ff00')
          .setDescription(`L'utilisateur ${userToModify} a été ${command === 'blacklist' ? 'ajouté à' : 'retiré de'} la liste noire.`)
        ]
      });

    } catch (error) {
      const embed = new MessageEmbed()
        .setColor('#ff0000')
        .setTitle(`Erreur lors de ${command === 'blacklist' ? 'l\'ajout à' : 'le retrait de'} la liste noire`)
        .setDescription(`Une erreur s'est produite lors de ${command === 'blacklist' ? 'l\'ajout à' : 'le retrait de'} la liste noire.\n\nErreur: ${error.message}`);

      console.error(`Erreur lors de ${command === 'blacklist' ? 'l\'ajout à' : 'le retrait de'} la liste noire :`, error.message);
      message.reply({ embeds: [embed] });
    }
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  try {
    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;
    if (!guild) throw new Error('La guilde d\'interaction n\'est pas définie.');

    const userId = interaction.user.id;

    if (await isUserBlacklisted(userId)) {
      const message = config.blacklistMessage.trim();
      if (message) {
        return interaction.followUp({ content: message, ephemeral: true });
      }
    }

    if (hasTicket(userId)) {
      const message = config.ticketOuvertMessage.trim();
      if (message) {
        return interaction.followUp({ content: message, ephemeral: true });
      }
    }

    switch (interaction.customId) {
      case 'aide':
        const roleId1 = config.ticketRoles.role1;
        const roleId2 = config.ticketRoles.role2;
        const parentCatégorie= config.parentCatégorie; 
    
        const role1 = guild.roles.cache.get(roleId1);
        const role2 = guild.roles.cache.get(roleId2);
    
        if (role1 && role2) {
          const ticketChannel = await guild.channels.create(`ticket-${interaction.user.username}`, {
            type: 'text',
            parent: parentCatégorie,
          });

          await ticketChannel.permissionOverwrites.create(interaction.user, { VIEW_CHANNEL: true, SEND_MESSAGES: true });
          await ticketChannel.permissionOverwrites.create(guild.id, { VIEW_CHANNEL: false });
          await ticketChannel.send(`${role1},${role2}`);

          tickets[ticketChannel.id] = { channelId: ticketChannel.id, par: userId };
          await saveTickets();

          const EmbedTicket = config.EmbedTicket || {};
          const initialEmbed = new MessageEmbed()
            .setColor(EmbedTicket.color || '')
            .setTitle(EmbedTicket.title || '')
            .setDescription(EmbedTicket.description || '');

          const deleteButton = new MessageButton()
            .setCustomId('suprimmer_ticket')
            .setLabel('🗑️ | Supprimer le ticket')
            .setStyle('DANGER');

          const row = new MessageActionRow().addComponents(deleteButton);

          await ticketChannel.send({ embeds: [initialEmbed], components: [row] });
          const message = config.ticketCreationMessage.trim();
          const replacedMessage = message.replace(/\${ticketChannelMention}/g, `<#${ticketChannel.id}>`);

          if (replacedMessage) {
            await interaction.followUp({ content: replacedMessage, ephemeral: true });

            const logOuvertEmbed = new MessageEmbed()
            .setColor("#00ff00")
            .setTitle("Ticket Ouvert")
            .setDescription(`Un ticket a été ouvert par ${interaction.user.tag}.`)
            .addFields(
            { name: "Utilisateur", value: interaction.user.tag, inline: true },
            { name: "ID Utilisateur", value: interaction.user.id, inline: true }
        );

            const logChannelOuvert = client.channels.cache.get(config.logChannelOuvert);
          if (logChannelOuvert) {
            await logChannelOuvert.send({ embeds: [logOuvertEmbed] });
            }
          }
        } else {
          console.error('L\'un des deux rôles ou les deux n\'ont pas été trouvés.');
        }

        break;

      default:
        break;
    }
  } catch (error) {
    console.error('Erreur lors de l\'interaction :', error.message);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton() && interaction.customId === 'suprimmer_ticket') {
    try {
      const channelId = interaction.channelId;
      const ticket = tickets[channelId];

      if (!ticket) throw new Error('Ticket introuvable.');

      const channel = interaction.guild.channels.cache.get(channelId);

      await new Promise(resolve => setTimeout(resolve, 1000));

      await channel.delete();

      delete tickets[channelId];
      await saveTickets();

      const logFerméEmbed = new MessageEmbed()
      .setColor("#ff0000")
      .setTitle("Ticket Fermé")
      .setDescription(`Le ticket a été fermé par ${interaction.user.tag}.`)
      .addFields(
      { name: "Utilisateur", value: interaction.user.tag, inline: true },
      { name: "ID Utilisateur", value: interaction.user.id, inline: true }
  );

      const logChannelFermé = client.channels.cache.get(config.logChannelFermé);
      if (logChannelFermé) {
      await logChannelFermé.send({ embeds: [logFerméEmbed] });
  }
    } catch (error) {
      console.error('Erreur lors de la suppression du ticket :', error.message);
    }
  }
});

function hasTicket(userId) {
  return Object.values(tickets).some((ticket) => ticket.par === userId);
}

async function loadTickets() {
  const filePath = path.join(__dirname, 'tickets.json');

  try {
    const data = await fs.readFile(filePath, 'utf8');
    tickets = JSON.parse(data) || {};
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('Le fichier tickets.json n\'existe pas. Création du fichier...');
      await saveTickets();
    } else {
    }
  }
}

async function saveTickets() {
  const filePath = path.join(__dirname, 'tickets.json');

  try {
    await fs.writeFile(filePath, JSON.stringify(tickets, null, 2));
  } catch (error) {
    console.error('Erreur lors de la sauvegarde des tickets :', error);
  }
}

async function loadBlacklist() {
  const blacklistPath = path.join(__dirname, 'blacklist.json');

  try {
    const data = await fs.readFile(blacklistPath, 'utf8');
    blacklist = JSON.parse(data) || [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('Le fichier blacklist.json n\'existe pas. Création du fichier...');
      await saveBlacklist();
    } else {
      console.error('Erreur lors du chargement de la liste noire :', error);
    }
  }
}

async function saveBlacklist() {
  const blacklistPath = path.join(__dirname, 'blacklist.json');

  try {
    await fs.writeFile(blacklistPath, JSON.stringify(blacklist, null, 2));
  } catch (error) {
    console.error('Erreur lors de la sauvegarde de la liste noire :', error);
  }
}

async function addToBlacklist(userId) {
  const blacklistPath = path.join(__dirname, 'blacklist.json');

  try {
    const data = await fs.readFile(blacklistPath, 'utf8');
    let blacklist = JSON.parse(data) || [];

    if (blacklist.includes(userId)) {
      throw new Error("L'utilisateur est déjà dans la liste noire.");
    }

    blacklist.push(userId);
    await fs.writeFile(blacklistPath, JSON.stringify(blacklist, null, 2));

    return true; 
  } catch (error) {
    throw new Error(`Erreur lors de l'ajout à la liste noire : ${error.message}`);
  }
}

async function removeFromBlacklist(userId) {
  const blacklistPath = path.join(__dirname, 'blacklist.json');

  try {
    const data = await fs.readFile(blacklistPath, 'utf8');
    let blacklist = JSON.parse(data) || [];

    if (!blacklist.includes(userId)) {
      throw new Error("L'utilisateur n'est pas dans la liste noire.");
    }

    blacklist = blacklist.filter(id => id !== userId);
    await fs.writeFile(blacklistPath, JSON.stringify(blacklist, null, 2));

    return true; 
  } catch (error) {
    throw new Error(`Erreur lors du retrait de la liste noire : ${error.message}`);
  }
}

async function isUserBlacklisted(userId) {
  const blacklistPath = path.join(__dirname, 'blacklist.json');

  try {
    const data = await fs.readFile(blacklistPath, 'utf8');
    const blacklist = JSON.parse(data) || [];

    return blacklist.includes(userId);
  } catch (error) {
    console.error('Erreur lors de la vérification de la liste noire :', error.message);
    return false;
  }
}

process.on('uncaughtException', (error) => {
  console.error('Erreur non gérée :', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Rejet de promesse non géré :', error);
});

client.login(config.token);