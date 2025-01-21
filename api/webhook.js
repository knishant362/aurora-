// Import necessary modules
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const sharp = require('sharp');
const FormData = require('form-data');
const os = require('os');
const fs = require('fs');

// Helper function to fetch albums
const fetchAlbums = async () => {
    const response = await axios.get('https://aurora.pockethost.io/api/collections/album/records');
    return response.data.items.map(album => ({
        text: `${album.name} (${album.id})`, // Show album name with ID
        callback_data: album.id, // Use album ID as callback data
    }));
};

// Helper function to fetch image URL using Telegram Bot API
const getImageUrl = async (bot, fileId) => {
    const file = await bot.getFile(fileId);
    return `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${file.file_path}`;
};

// Helper function to process and upload the image
const uploadImage = async (imageBuffer, title, resolution, albumId, fileId) => {
    const form = new FormData();
    form.append('title', title);
    form.append('resolution', resolution);
    form.append('album_id', albumId);

    const tempFilePath = `${os.tmpdir()}/${fileId}.jpg`;
    fs.writeFileSync(tempFilePath, imageBuffer);
    form.append('image_file', fs.createReadStream(tempFilePath));

    try {
        const uploadResponse = await axios.post(
            'https://aurora.pockethost.io/api/collections/wallpaper/records',
            form,
            { headers: { ...form.getHeaders() } }
        );
        return uploadResponse.data;
    } catch (error) {
        throw new Error('Error uploading image: ' + error.message);
    } finally {
        fs.unlinkSync(tempFilePath); // Clean up the temporary file
    }
};

// Maintain a set of processed update IDs to prevent duplicate handling
const processedUpdates = new Set();

// Main webhook function
module.exports = async (request, response) => {
    try {
        console.log('Received webhook request:', request.body);

        const botToken = process.env.TELEGRAM_TOKEN;
        if (!botToken) {
            throw new Error('TELEGRAM_TOKEN is not set in the environment variables');
        }

        const bot = new TelegramBot(botToken);
        const { body } = request;

        // Check if this update has already been processed
        if (body.update_id && processedUpdates.has(body.update_id)) {
            console.log(`Duplicate update ignored: ${body.update_id}`);
            response.status(200).send('OK');
            return;
        }

        // Mark the update as processed
        if (body.update_id) {
            processedUpdates.add(body.update_id);
        }

        // Acknowledge Telegram's request immediately
        response.status(200).send('OK');

        if (body.message) {
            const { chat: { id: chatId }, text, photo, caption } = body.message;

            // Handle /album command
            if (text === '/album') {
                const albums = await fetchAlbums();
                const options = {
                    reply_markup: {
                        inline_keyboard: albums.map(album => [album]), // One album per row
                    },
                };

                await bot.sendMessage(
                    chatId,
                    'Select an album to copy its ID. Once you have the ID, upload an image with a caption in the format: `title, album_id`',
                    options
                );
                return;
            }

            // Handle image upload with caption
            if (photo && caption) {
                const parts = caption.split(',');
                if (parts.length === 2) {
                    const title = parts[0].trim();
                    const albumId = parts[1].trim();

                    const fileId = photo[photo.length - 1].file_id;
                    const fileUrl = await getImageUrl(bot, fileId);

                    const imageResponse = await axios({
                        method: 'get',
                        url: fileUrl,
                        responseType: 'arraybuffer',
                    });

                    const imageBuffer = Buffer.from(imageResponse.data);
                    const metadata = await sharp(imageBuffer).metadata();
                    const resolution = `${metadata.width}x${metadata.height}`;

                    const uploadResponse = await uploadImage(imageBuffer, title, resolution, albumId, fileId);
                    console.log('Image uploaded successfully:', uploadResponse);

                    const reply = `✅ *Title*: ${title}\n✅ *Album ID*: ${albumId}\n✅ *Resolution*: ${resolution}\n\nYour image has been uploaded successfully.`;
                    await bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
                } else {
                    await bot.sendMessage(chatId, '⚠️ Invalid caption format. Use: `title, album_id`.', { parse_mode: 'Markdown' });
                }
                return;
            }

            // Handle invalid inputs
            await bot.sendMessage(chatId, 'Invalid command. Use /album to fetch album IDs or upload an image with a caption in the format: `title, album_id`.', { parse_mode: 'Markdown' });
        }

        // Handle callback queries for album selection
        if (body.callback_query) {
            const { id: queryId, data: albumId, message } = body.callback_query;
            const chatId = message.chat.id;

            // Respond to the callback query
            await bot.answerCallbackQuery(queryId, {
                text: `Album ID copied: ${albumId}`,
                show_alert: true,
            });

            // Send the album ID as a message for easier copying
            await bot.sendMessage(chatId, `📋 Album ID: *${albumId}*\n\nNow upload an image with a caption in the format:\n\`title, album_id\``, {
                parse_mode: 'Markdown',
            });
        }
    } catch (error) {
        console.error('Error handling webhook request:', error);
    }
};
