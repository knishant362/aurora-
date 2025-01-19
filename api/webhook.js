// https://github.com/yagop/node-telegram-bot-api/issues/319#issuecomment-324963294
// Fixes an error with Promise cancellation
process.env.NTBA_FIX_319 = 'test';

// Require our Telegram helper package
const TelegramBot = require('node-telegram-bot-api');

// Export as an asynchronous function
// We'll wait until we've responded to the user
module.exports = async (request, response) => {
    console.log('Received webhook request:', request.body);  // Log the incoming body for debugging

    try {
        // Create the bot handler with the token from environment variables
        const bot = new TelegramBot(process.env.TELEGRAM_TOKEN);

        // Ensure the request body has a message
        const { body } = request;
        if (body && body.message) {
            const { chat: { id }, text } = body.message;

            console.log(`Received message: "${text}" from chat ID: ${id}`);

            // Create a response message
            const message = `✅ Thanks for your message: *"${text}"*\nHave a great day! 👋🏻`;

            // Send a response message back to the chat
            await bot.sendMessage(id, message, { parse_mode: 'Markdown' });

            console.log(`Sent message to chat ID ${id}: "${message}"`);
        } else {
            console.log('No valid message in the request body');
            response.status(400).json({ error: 'Invalid request, no message found' });  // Return a 400 if no message
            return;
        }
    }
    catch (error) {
        // If there's an error, log it and send a 500 response
        console.error('Error handling webhook request:', error);
        response.status(500).json({ error: 'Internal Server Error' });  // Return 500 if there's a server error
        return;
    }

    // Acknowledge the request with a 200 HTTP status code (Telegram will expect this)
    response.status(200).send('OK');
};
