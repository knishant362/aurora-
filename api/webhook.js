// Import necessary modules
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// Helper function to fetch albums
const fetchAlbums = async () => {
    const response = await axios.get('https://aurora.pockethost.io/api/collections/album/records');
    return response.data.items.map(album => ({
        text: `${album.name} (${album.id})`, // Show album name with ID
        callback_data: album.id, // Use album ID as callback data
    }));
};

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

        if (body && body.message) {
            const { chat: { id: chatId }, text } = body.message;

            // Step 1: Handle /start command
            if (text === '/start') {
                // Fetch and display album options
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

            // Handle invalid input
            await bot.sendMessage(chatId, 'Invalid input. Please start by sending /start.');
        }

        // Step 2: Handle album selection (callback query)
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

        response.status(200).send('OK');
    } catch (error) {
        console.error('Error handling webhook request:', error);
        response.status(500).json({ error: 'Internal Server Error' });
    }
};
