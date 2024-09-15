const axios = require('axios');
const cheerio = require("cheerio");
const { ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder } = require("discord.js");
const moment = require("moment-timezone");
const db = require("./db");

// Fonction pour récupérer les données de l'API externe sans conserver de cache
async function fetchNextData(options) {
    const url = "https://api.zyte.com/v1/extract";
    const depString = options.dep?.map(dep => `d_${dep}`).join(",") || "";

    let fetchUrl = `https://www.leboncoin.fr/recherche?category=2`;
    if (depString) fetchUrl += `&locations=${depString}`;
    if (options.brand) fetchUrl += `&u_car_brand=${options.brand}`;
    if (options.models) fetchUrl += `&u_car_model=${options.brand}_${options.models}`;
    if (options.sort) fetchUrl += `&sort=${options.sort}`;
    if (options.price) fetchUrl += `&price=${options.price}`;
    if (options.mileage) fetchUrl += `&mileage=${options.mileage}`;

    try {
        const response = await axios.post(url, {
            "url": fetchUrl,
            "httpResponseBody": true
        }, {
            auth: { username: '92ceaac5e51441e7866d731cfc0c2afd' }
        });

        if (response.status !== 200) throw new Error(`HTTP error! status: ${response.status}`);

        const httpResponseBody = Buffer.from(response.data.httpResponseBody, "base64").toString();
        const $ = cheerio.load(httpResponseBody);
        const scriptContent = $('#__NEXT_DATA__').html();

        if (!scriptContent) throw new Error("La balise <script id='__NEXT_DATA__'> n'a pas été trouvée.");

        return JSON.parse(scriptContent);
    } catch (error) {
        console.error('Erreur lors de la récupération des données :', error.message);
        return null;
    }
}

// Fonction pour vérifier la distance en appelant l'API Google Maps sans maintenir de cache
async function checkDistance(origin, destination) {
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?units=metric&origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(destination)}&key=AIzaSyDVpX2-v2O1VhGO1TJSHx8K8f2p1iuGd8A`;

    try {
        const response = await axios.get(url);
        const data = response.data;

        return {
            distance: data.rows[0].elements[0].distance.text,
            time: data.rows[0].elements[0].duration.text
        };
    } catch (error) {
        console.error('Erreur lors de la vérification de la distance :', error.message);
        return { distance: 'N/A', time: 'N/A' };
    }
}

async function sendToDiscord(channel, options, activeSearches) {
    if (!activeSearches.has(channel.id)) return;

    try {
        const brutData = await fetchNextData(options);
        if (!brutData) {
            await reload(channel, options, activeSearches);
            return;
        }

        const adsData = brutData.props.pageProps.searchData.ads;
        if (!adsData || adsData.length === 0) {
            await reload(channel, options, activeSearches);
            return;
        }
        const latestAd = adsData[0];

        const storedListId = await db.get(`latestData_${channel.id}`);
        if (storedListId === latestAd.list_id) {
            await reload(channel, options, activeSearches);
            return;
        }

        await db.set(`latestData_${channel.id}`, latestAd.list_id);

        const {
            subject, body, list_id, index_date, price, location, images, attributes
        } = latestAd;

        const annonceButton = new ButtonBuilder()
            .setURL(`https://www.leboncoin.fr/ad/voitures/${list_id}`)
            .setLabel("🔎 Annonce")
            .setStyle(ButtonStyle.Link);

        const sendMessageButton = new ButtonBuilder()
            .setURL(`https://www.leboncoin.fr/reply/${list_id}`)
            .setLabel("📩 Envoyer un message")
            .setStyle(ButtonStyle.Link);

        const addFavoriteButton = new ButtonBuilder()
            .setCustomId(`favorite_${list_id}`)
            .setLabel("⭐ Ajouter favoris")
            .setStyle(ButtonStyle.Primary);

        const getAttributeValue = (key) => attributes.find(attr => attr.key === key)?.value_label || 'Non spécifié';

        const distanceValue = await checkDistance("Sevran", location.city);

        const embeds = (images?.urls || []).slice(0, 5).map((url, index) => new EmbedBuilder()
            .setTitle(subject)
            .setURL(`https://www.leboncoin.fr/voitures/${list_id}`)
            .setTimestamp(new Date(index_date))
            .setColor(3066993)
            .setImage(url || 'https://via.placeholder.com/150')
            .addFields(
                { name: "Prix", value: `${formatPrice(price)}€`, inline: true },
                { name: "Ville", value: `${location.city_label}`, inline: true },
                { name: "Modèle", value: `${getAttributeValue("u_car_model")}`, inline: true },
                { name: "Année modèle", value: `${getAttributeValue("regdate")}`, inline: true },
                { name: "Kilométrage", value: `${getAttributeValue("mileage")}`, inline: true },
                { name: "Carburant", value: `${getAttributeValue("fuel")}`, inline: true },
                { name: "Mise en ligne", value: `<t:${toUnix(index_date)}:R>`, inline: true },
                { name: "Distance", value: `${distanceValue.distance} (${distanceValue.time})`, inline: true }
            ));

        let comp = new ActionRowBuilder().setComponents(sendMessageButton, annonceButton, addFavoriteButton);

        await channel.send({ embeds, components: [comp] });

        await reload(channel, options, activeSearches);
    } catch (error) {
        console.error(`Error in sendToDiscord for channel ${channel.id}:`, error);
    } finally {
        // Nettoyage des variables après envoi du message
        options = null;
        comp = null;
    }
}

// Formatage du prix
function formatPrice(price) {
    return price?.toString()?.replace(/\B(?=(\d{3})+(?!\d))/g, " ") || price;
}

async function reload(channel, options, activeSearches) {
    try {
        await delay(20000);
        await sendToDiscord(channel, options, activeSearches);
    } catch (error) {
        console.error('Erreur lors du rechargement :', error.message);
    } finally {
        channel = null;
        options = null;
    }
}

function toUnix(dateString) {
    return moment.tz(dateString, 'Europe/Paris').unix() || 0;
}

// Fonction de délai pour les rechargements
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { sendToDiscord };
