// This file should be placed in the `api` directory at the root of your project.
import type { IncomingMessage, ServerResponse } from "http";

// Helper function to read the request body
function readRequestBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            resolve(body);
        });
        req.on('error', err => {
            reject(err);
        });
    });
}

// The main function that Vercel will execute
export default async function handler(req: IncomingMessage, res: ServerResponse) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle OPTIONS preflight request
    if (req.method === 'OPTIONS') {
        res.statusCode = 200;
        res.end();
        return;
    }

    // Helper to send JSON responses
    const sendJson = (statusCode: number, data: any) => {
        res.statusCode = statusCode;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(data));
    };

    if (req.method !== 'POST') {
        return sendJson(405, { error: 'Method Not Allowed' });
    }

    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) {
        console.error('DISCORD_WEBHOOK_URL environment variable is not set.');
        return sendJson(500, { error: 'Server configuration error: Discord webhook URL is missing.' });
    }

    try {
        const bodyString = await readRequestBody(req);
        const { message } = JSON.parse(bodyString);

        if (!message || typeof message !== 'string') {
            return sendJson(400, { error: 'Message is required and must be a string.' });
        }

        const payload = { content: message };

        const discordResponse = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!discordResponse.ok) {
            const errorBody = await discordResponse.json();
            console.error('Discord API error:', errorBody);
            return sendJson(discordResponse.status, { error: `Discord API Error: ${errorBody.message || 'Unknown error'}` });
        }

        sendJson(200, { success: true, message: 'Message sent to Discord.' });

    } catch (error) {
        console.error('Failed to send message to Discord:', error);
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
        sendJson(500, { error: `An internal error occurred while sending the message: ${errorMessage}` });
    }
}
