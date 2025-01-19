// Fixes an error with Promise cancellation
process.env.NTBA_FIX_319 = 'test';

// Require our Telegram helper package
const TelegramBot = require('node-telegram-bot-api');

// Require necessary packages for image processing and resolution extraction
const sharp = require('sharp');
const axios = require('axios'); // Import axios for HTTP requests
const FormData = require('form-data'); // Import FormData for file uploads
const fs = require('fs'); // File system module to write temporary files

// Export the webhook function
module.exports = async (request, response) => {
    try {
        console.log('Received webhook request:', request.body); // Log the incoming body for debugging

        // Ensure the required environment variable is set
        const botToken = process.env.TELEGRAM_TOKEN;
        if (!botToken) {
            console.error('TELEGRAM_TOKEN is not set in the environment variables');
            response.status(500).json({ error: 'Telegram token is not set' });
            return;
        }

        // Create the bot handler with the token
        const bot = new TelegramBot(botToken);

        // Parse the incoming request
        const { body } = request;

        // Ensure the request contains a message
        if (body && body.message) {
            const { chat: { id }, caption, photo } = body.message;

            // Check if the message contains a photo and a caption
            if (photo && caption) {
                console.log(`Received photo with caption from chat ID: ${id}`);
                console.log(`Caption: ${caption}`);

                // Validate and parse the caption (title, album_id)
                const parts = caption.split(',');
                if (parts.length === 2) {
                    const title = parts[0].trim();
                    const albumId = parts[1].trim();

                    console.log(`Parsed title: "${title}", album_id: "${albumId}"`);

                    // Get the highest resolution photo
                    const fileId = photo[photo.length - 1].file_id;

                    // Fetch the photo URL
                    const file = await bot.getFile(fileId);
                    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;

                    // Download the image for processing using axios
                    const imageResponse = await axios({
                        method: 'get',
                        url: fileUrl,
                        responseType: 'arraybuffer', // Important: This ensures the image is returned as a binary buffer
                    });

                    // Ensure we correctly handle the image data
                    const imageBuffer = Buffer.from(imageResponse.data);

                    // Extract resolution using sharp
                    const metadata = await sharp(imageBuffer).metadata();
                    const resolution = `${metadata.width}x${metadata.height}`;

                    console.log(`Extracted image resolution: ${resolution}`);

                    // Prepare the form data for uploading the image
                    const form = new FormData();
                    form.append('title', title);
                    form.append('resolution', resolution);
                    form.append('album_id', albumId);

                    // Save the image temporarily to send it in the form data
                    const tempFilePath = `${os.tmpdir()}/${fileId}.jpg`; // Use the OS temp directory
                    fs.writeFileSync(tempFilePath, imageBuffer);
                    form.append('image_file', fs.createReadStream(tempFilePath));

                    // Make the API call to upload the image
                    const uploadResponse = await axios.post(
                        'https://aurora.pockethost.io/api/collections/wallpaper/records',
                        form,
                        {
                            headers: {
                                ...form.getHeaders(),
                            }
                        }
                    );

                    console.log('Image uploaded successfully:', uploadResponse.data);

                    // Remove the temp file after upload
                    fs.unlinkSync(tempFilePath);

                    // Respond with a confirmation message
                    const reply = `✅ Title: *${title}*\n✅ Album ID: *${albumId}*\n✅ Image Resolution: *${resolution}*\n\nYour image and details have been uploaded successfully.`;
                    await bot.sendMessage(id, reply, { parse_mode: 'Markdown' });

                    console.log(`Sent confirmation message to chat ID ${id}: "${reply}"`);
                } else {
                    // Invalid caption format
                    const errorReply = `⚠️ Invalid caption format.\n\nPlease include the title and album ID in the caption, separated by a comma:\n\n\`title,album_id\`\n\nFor example:\n\`Samurai Girl,12345\``;
                    await bot.sendMessage(id, errorReply, { parse_mode: 'Markdown' });
                    console.log(`Sent error message to chat ID ${id}: "${errorReply}"`);
                }
            } else if (!photo) {
                // If there's no photo, notify the user
                const errorReply = `⚠️ Please upload an image with a caption containing the title and album ID in the format: \`title,album_id\`.`;
                await bot.sendMessage(id, errorReply, { parse_mode: 'Markdown' });
                console.log(`Sent error message to chat ID ${id}: "${errorReply}"`);
            } else {
                // If there's no caption, notify the user
                const errorReply = `⚠️ Please include a caption with the title and album ID in the format: \`title,album_id\`.`;
                await bot.sendMessage(id, errorReply, { parse_mode: 'Markdown' });
                console.log(`Sent error message to chat ID ${id}: "${errorReply}"`);
            }
        } else {
            console.log('No valid message in the request body');
            response.status(400).json({ error: 'Invalid request, no message found' }); // Return a 400 if no message
            return;
        }
    } catch (error) {
        // If there's an error, log it and send a 500 response
        console.error('Error handling webhook request:', error);
        response.status(500).json({ error: 'Internal Server Error' }); // Return 500 if there's a server error
        return;
    }

    // Acknowledge the request with a 200 HTTP status code
    response.status(200).send('OK');
};
