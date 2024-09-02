const { Client, GatewayIntentBits, Collection, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { sendToDiscord } = require('./itemTracker');
const fs = require('fs');
require('dotenv').config();
const db = require("./db")

const token = process.env.DISCORD_TOKEN;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

client.once('ready', async () => {
    console.log('Bot is ready!');
    await loadTrackedChannels();

    const trackedChannels = await db.get('trackedChannels') || {};
    const activeSearches = new Set(Object.keys(trackedChannels));

    for (const [channelId, info] of Object.entries(trackedChannels)) {
        const channel = client.channels.cache.get(channelId);
        if (channel) {
            await sendToDiscord(channel, info, activeSearches);
        } else {
            console.log(`Channel ${channelId} not found, removing from tracked channels.`);
            await cleanUpChannel(channelId);
        }
    }
});

const loadTrackedChannels = async () => {
    // Load tracked channels from DB if needed
};

const saveTrackedChannels = async (trackedChannels) => {
    await db.set('trackedChannels', trackedChannels);
};

const cleanUpChannel = async (channelId) => {
    const trackedChannels = await db.get('trackedChannels') || {};
    delete trackedChannels[channelId];
    await db.set('trackedChannels', trackedChannels);
};

const generateFavoriteId = () => `fav-${Math.random().toString(36).substr(2, 9)}`;

const handleButton = async (interaction) => {
    const customId = interaction.customId;
    const listId = customId.split("_")[1];
    const embed = new EmbedBuilder();

    if (customId.startsWith("previous") || customId.startsWith("next")) {
        console.log("Navigating pages...");
    } else {
        const favoriteId = generateFavoriteId();
        let favorites = await db.get('favorites') || [];
        if (!favorites.some(fav => fav.listId === listId)) {
            favorites.push({ id: favoriteId, listId, channelId: interaction.channel.id, userId: interaction.user.id });
            await db.set('favorites', favorites);
            embed.setTitle("✅ Annonce ajoutée aux favoris");
            await interaction.reply({ embeds: [embed], ephemeral: true });
        } else {
            embed.setTitle("❌ Annonce déjà dans les favoris");
            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
    }
};

client.on('interactionCreate', async interaction => {
    try {
        if (!interaction.isCommand()) {
            if (interaction.isButton()) await handleButton(interaction);
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        const { commandName, options } = interaction;

        if (commandName === 'search') {
            const brand = options.getString('brand').toUpperCase();
            const sort = options.getString('sort');
            const dep = options.getString('departements') ? JSON.parse(options.getString('departements')) : null;
            const models = options.getString('modele');
            const price = options.getString('prix');
            const mileage = options.getString('kilometrage');
            const category = interaction.channel.parent;

            if (!category) {
                return interaction.editReply({ content: 'Impossible de déterminer la catégorie de ce salon.', ephemeral: true });
            }

            const channelName = `${brand}-${models || ""}-${sort}-${dep ? dep.join('-') : "all"}`;
            const channel = await category.guild.channels.create({
                name: channelName,
                type: 0,
                parent: category.id
            });

            let topic = `Traque de ${brand}`;
            if (models) topic += `, Modèle: ${models}`;
            if (sort) topic += `, Tri: ${sort}`;
            if (dep) topic += `, Départements: ${dep.join(', ')}`;
            if (price) topic += `, Prix: ${price}`;
            if (mileage) topic += `, Kilométrage: ${mileage}`;
            await channel.setTopic(topic);

            interaction.editReply({ content: `Salon créé : ${channel}`, ephemeral: true });

            const trackedChannels = await db.get('trackedChannels') || {};
            trackedChannels[channel.id] = { brand, sort, dep, models, price, mileage };
            await saveTrackedChannels(trackedChannels);

            await sendToDiscord(channel, { brand, sort, dep, models, price, mileage }, new Set(Object.keys(trackedChannels)));
        } else if (commandName === 'unsearch') {
            const channelId = options.getString('channel_id');

            const trackedChannels = await db.get('trackedChannels') || {};
            if (trackedChannels[channelId]) {
                delete trackedChannels[channelId];
                await db.set('trackedChannels', trackedChannels);
                const channel = client.channels.cache.get(channelId);
                if (channel) {
                    await channel.delete();
                }
                interaction.editReply({ content: `Le suivi a été arrêté pour le salon : ${channelId}`, ephemeral: true });
            } else {
                interaction.editReply({ content: `Aucun suivi trouvé pour le salon : ${channelId}`, ephemeral: true });
            }
        } else if (commandName === 'listsearches') {
            const trackedChannels = await db.get('trackedChannels') || {};
            const embed = new EmbedBuilder()
                .setTitle('Recherches en cours')
                .setDescription('Voici la liste des salons suivis:')
                .setColor(0x00AE86);

            for (const [channelId, info] of Object.entries(trackedChannels)) {
                const channel = client.channels.cache.get(channelId);
                if (channel) {
                    embed.addFields({
                        name: channel.name,
                        value: `[Cliquez ici pour accéder au salon](https://discord.com/channels/${interaction.guildId}/${channelId})   ${channelId}`,
                        inline: false
                    });
                }
            }

            interaction.editReply({ embeds: [embed], ephemeral: true });
        } else if (commandName === 'favoris') {
            const ITEMS_PER_PAGE = 10;
            let currentPage = 0;

            const generateEmbed = async (page) => {
                const embed = new EmbedBuilder()
                    .setTitle('📋 Liste des favoris')
                    .setColor(0x3498db)
                    .setDescription('Voici la liste de toutes les annonces mises en favoris :');

                const favorites = await db.get('favorites') || [];
                const start = page * ITEMS_PER_PAGE;
                const end = start + ITEMS_PER_PAGE;
                const pageFavorites = favorites.slice(start, end);

                for (const fav of pageFavorites) {
                    const { listId } = fav;
                    embed.addFields({
                        name: listId,
                        value: `ID : ${listId}`
                    });
                }

                embed.setFooter({ text: `Page ${page + 1} sur ${Math.ceil(favorites.length / ITEMS_PER_PAGE)}` });
                return embed;
            };

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('previous_fav')
                        .setLabel('◀️ Précédent')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(currentPage === 0),
                    new ButtonBuilder()
                        .setCustomId('next_fav')
                        .setLabel('▶️ Suivant')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(currentPage === Math.ceil((await db.get('favorites') || []).length / ITEMS_PER_PAGE) - 1)
                );

            const embed = await generateEmbed(currentPage);

            await interaction.editReply({ embeds: [embed], components: [row], ephemeral: true });

            const collector = interaction.channel.createMessageComponentCollector({ time: 60000 });

            collector.on('collect', async i => {
                if (i.customId === 'previous_fav') {
                    currentPage--;
                } else if (i.customId === 'next_fav') {
                    currentPage++;
                }

                const updatedEmbed = await generateEmbed(currentPage);

                await i.update({ embeds: [updatedEmbed], components: [row], ephemeral: true });
            });

            // Clean up the collector after it's done
            collector.on('end', () => {
                console.log('Collector ended.');
                // Disable buttons after the collector ends
                interaction.editReply({ components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('previous_fav').setLabel('◀️ Précédent').setStyle(ButtonStyle.Primary).setDisabled(true),
                        new ButtonBuilder().setCustomId('next_fav').setLabel('▶️ Suivant').setStyle(ButtonStyle.Primary).setDisabled(true)
                    )] });
            });
        } else if (commandName === 'unfav') {
            const favId = options.getString('id');

            let favorites = await db.get('favorites') || [];
            const index = favorites.findIndex(fav => fav.id === favId);
            if (index !== -1) {
                favorites.splice(index, 1);
                await db.set('favorites', favorites);
                interaction.editReply({ content: `Favori supprimé avec succès : ${favId}`, ephemeral: true });
            } else {
                interaction.editReply({ content: `Aucun favori trouvé avec l'ID : ${favId}`, ephemeral: true });
            }
        }
    } catch (error) {
        console.error(error);
        interaction.editReply({ content: 'Une erreur est survenue lors de l\'exécution de la commande.', ephemeral: true });
    }
});

(async () => {
    const commands = [
        new SlashCommandBuilder()
            .setName('search')
            .setDescription('Rechercher des annonces')
            .addStringOption(option => option.setName('brand').setDescription('La marque du véhicule').setRequired(true))
            .addStringOption(option => option.setName('sort').setDescription('Critère de tri (ex: time)').setRequired(true))
            .addStringOption(option => option.setName('departements').setDescription('Choisir les départements').setRequired(false))
            .addStringOption(option => option.setName('modele').setDescription('Choisir un modèle').setRequired(false))
            .addStringOption(option => option.setName('prix').setDescription('Choisir une tranche de prix (Ex: 100-1000)').setRequired(false))
            .addStringOption(option => option.setName('kilometrage').setDescription('Choisir une tranche de kilométrage (Ex: 100-1000)').setRequired(false)),
        new SlashCommandBuilder()
            .setName('unsearch')
            .setDescription('Arrêter de suivre un salon')
            .addStringOption(option => option.setName('channel_id').setDescription('L\'ID du salon').setRequired(true)),
        new SlashCommandBuilder()
            .setName('listsearches')
            .setDescription('Lister toutes les recherches en cours'),
        new SlashCommandBuilder()
            .setName('favoris')
            .setDescription('Lister toutes les annonces mises en favoris'),
        new SlashCommandBuilder()
            .setName('unfav')
            .setDescription('Retirer une annonce des favoris')
            .addStringOption(option => option.setName('id').setDescription('L\'ID du favori').setRequired(true))
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(token);

    try {
        console.log('Started refreshing application (/) commands.');
        await rest.put(Routes.applicationCommands("1271571659047960618"), { body: commands });
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error reloading application (/) commands:', error);
    }
})();

client.login(token);
console.log("LOGGED");
