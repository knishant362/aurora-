// Fixes an error with Promise cancellation
process.env.NTBA_FIX_319 = 'test';

// Import necessary modules
const TelegramBot = require('node-telegram-bot-api');
const sharp = require('sharp');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const os = require('os'); // Ensure os is imported for temp file path

// Helper function to fetch image URL using Telegram Bot API
const getImageUrl = async (bot, fileId) => {
    const file = await bot.getFile(fileId);
    return `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${file.file_path}`;
};

// Helper function to download and process the image
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

// Helper function to upload the image to the server
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
        // Clean up the temporary file
        fs.unlinkSync(tempFilePath);
    }
};

// Helper function to send messages to Telegram users
const sendMessage = async (bot, chatId, message) => {
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
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
            const { chat: { id }, caption, photo } = body.message;

            // If the message contains a photo and a caption
            if (photo && caption) {
                const parts = caption.split(',');
                if (parts.length === 2) {
                    const title = parts[0].trim();
                    const albumId = parts[1].trim();

                    const fileId = photo[photo.length - 1].file_id;
                    const fileUrl = await getImageUrl(bot, fileId);
                    const { imageBuffer, resolution } = await processImage(fileUrl);

                    const uploadResponse = await uploadImage(imageBuffer, title, resolution, albumId, fileId);
                    console.log('Image uploaded successfully:', uploadResponse);

                    const reply = `✅ Title: *${title}*\n✅ Album ID: *${albumId}*\n✅ Image Resolution: *${resolution}*\n\nYour image and details have been uploaded successfully.`;
                    await sendMessage(bot, id, reply);
                } else {
                    const errorReply = `⚠️ Invalid caption format.\n\nPlease include the title and album ID in the caption, separated by a comma:\n\n\`title,album_id\``;
                    await sendMessage(bot, id, errorReply);
                }
            } else if (!photo) {
                const errorReply = `⚠️ Please upload an image with a caption containing the title and album ID in the format: \`title,album_id\`.`;
                await sendMessage(bot, id, errorReply);
            } else {
                const errorReply = `⚠️ Please include a caption with the title and album ID in the format: \`title,album_id\`.`;
                await sendMessage(bot, id, errorReply);
            }
        } else {
            console.log('No valid message in the request body');
            response.status(400).json({ error: 'Invalid request, no message found' });
            return;
        }
    } catch (error) {
        console.error('Error handling webhook request:', error);
        response.status(500).json({ error: 'Internal Server Error' });
        return;
    }

    response.status(200).send('OK');
};
