const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { sendToDiscord } = require('./itemTracker');
require('dotenv').config();
const db = require("./db");

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
    console.log('Bot is ready!');
    const trackedChannels = await db.get('trackedChannels') || {};
    const activeSearches = new Set(Object.keys(trackedChannels));

    for (const [channelId, info] of Object.entries(trackedChannels)) {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (channel) {
            await sendToDiscord(channel, info, activeSearches);
        } else {
            console.log(`Channel ${channelId} not found, removing from tracked channels.`);
            await cleanUpChannel(channelId);
        }
    }
});

const cleanUpChannel = async (channelId) => {
    await db.delete(`trackedChannels.${channelId}`);
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
        const favorites = await db.get('favorites') || [];
        if (!favorites.some(fav => fav.listId === listId)) {
            favorites.push({ id: favoriteId, listId, channelId: interaction.channel.id, userId: interaction.user.id });
            await db.set('favorites', favorites);
            embed.setTitle("✅ Annonce ajoutée aux favoris");
        } else {
            embed.setTitle("❌ Annonce déjà dans les favoris");
        }
        await interaction.reply({ embeds: [embed], ephemeral: true });
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

            await db.set(`trackedChannels.${channel.id}`, { brand, sort, dep, models, price, mileage });

            const trackedChannels = await db.get('trackedChannels') || {};
            const activeSearches = new Map(Object.entries(trackedChannels));

            console.log(activeSearches)

            await sendToDiscord(channel, { brand, sort, dep, models, price, mileage }, activeSearches)
        } else if (commandName === 'unsearch') {
            const channelId = options.getString('channel_id');
            await db.delete(`trackedChannels.${channelId}`);
            const channel = await client.channels.fetch(channelId).catch(() => null);
            if (channel) await channel.delete();
            interaction.editReply({ content: `Le suivi a été arrêté pour le salon : ${channelId}`, ephemeral: true });
        } else if (commandName === 'listsearches') {
            const trackedChannels = await db.get('trackedChannels') || {};
            const embed = new EmbedBuilder()
                .setTitle('Recherches en cours')
                .setDescription('Voici la liste des salons suivis:')
                .setColor(0x00AE86);

            for (const [channelId, info] of Object.entries(trackedChannels)) {
                const channel = await client.channels.fetch(channelId).catch(() => null);
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
                    embed.addFields({
                        name: fav.listId,
                        value: `ID : ${fav.listId}`
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

            collector.on('end', () => {
                // Désactiver les boutons après la fin de la collection
                interaction.editReply({ components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('previous_fav').setLabel('◀️ Précédent').setStyle(ButtonStyle.Primary).setDisabled(true),
                        new ButtonBuilder().setCustomId('next_fav').setLabel('▶️ Suivant').setStyle(ButtonStyle.Primary).setDisabled(true)
                    )] });
            });
        } else if (commandName === 'unfav') {
            const favId = options.getString('id');
            const favorites = await db.get('favorites') || [];
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
        interaction.editReply({ content: "Une erreur est survenue lors de l'exécution de la commande.", ephemeral: true });
    }
});

client.login(process.env.DISCORD_TOKEN);
