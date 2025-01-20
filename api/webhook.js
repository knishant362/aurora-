// Import necessary modules
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const sharp = require('sharp');
const FormData = require('form-data');
const fs = require('fs');
const os = require('os');

// Store user states
const userStates = {};

// Helper function to fetch albums
const fetchAlbums = async () => {
    const response = await axios.get('https://aurora.pockethost.io/api/collections/album/records');
    return response.data.items.map(album => ({
        text: album.name,
        callback_data: album.id, // Album ID
    }));
};

// Helper function to process image
const processImage = async (fileUrl) => {
    const imageResponse = await axios({
        method: 'get',
        url: fileUrl,
        responseType: 'arraybuffer',
    });

    const imageBuffer = Buffer.from(imageResponse.data);
    const metadata = await sharp(imageBuffer).metadata();
    const resolution = `${metadata.width}x${metadata.height}`;

    return { imageBuffer, resolution };
};

// Helper function to upload the image
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
        fs.unlinkSync(tempFilePath); // Clean up temp file
    }
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
                await bot.sendMessage(chatId, 'Select an album to upload an image:', options);

                // Update user state
                userStates[chatId] = { step: 'waiting_for_image' };
                return;
            }

            // Step 2: Handle image upload
            if (userStates[chatId]?.step === 'waiting_for_image' && body.message.photo) {
                const { albumId } = userStates[chatId];
                if (!albumId) {
                    await bot.sendMessage(chatId, 'Please select an album first by sending /start.');
                    return;
                }

                const fileId = body.message.photo[body.message.photo.length - 1].file_id;
                const fileUrl = await bot.getFileLink(fileId);
                const { imageBuffer, resolution } = await processImage(fileUrl);

                // Upload the image
                const title = `Uploaded Image`; // You can customize this
                await uploadImage(imageBuffer, title, resolution, albumId, fileId);

                await bot.sendMessage(chatId, `✅ Image uploaded successfully to album: ${albumId}`);

                // Reset user state
                delete userStates[chatId];
                return;
            }

            // Handle invalid input
            await bot.sendMessage(chatId, 'Invalid input. Please start by sending /start.');
        }

        // Step 3: Handle album selection (callback query)
        if (body.callback_query) {
            const { id: queryId, data: albumId, message } = body.callback_query;
            const chatId = message.chat.id;

            // Save album selection
            userStates[chatId] = { step: 'waiting_for_image', albumId };

            // Respond to the callback query
            await bot.answerCallbackQuery(queryId, {
                text: `Album selected: ${albumId}. Please upload an image.`,
                show_alert: false,
            });

            // Prompt user to upload an image
            await bot.sendMessage(chatId, `You selected album: ${albumId}. Now, please upload an image.`);
        }

        response.status(200).send('OK');
    } catch (error) {
        console.error('Error handling webhook request:', error);
        response.status(500).json({ error: 'Internal Server Error' });
    }
};
