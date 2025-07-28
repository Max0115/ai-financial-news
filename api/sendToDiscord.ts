// This file should be placed in the `api` directory at the root of your project.
import type { VercelRequest, VercelResponse } from "@vercel/node";

// The main function that Vercel will execute
export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle OPTIONS preflight request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) {
        console.error('DISCORD_WEBHOOK_URL environment variable is not set.');
        return res.status(500).json({ error: 'Server configuration error: Discord webhook URL is missing.' });
    }

    try {
        const { message } = req.body;

        if (!message || typeof message !== 'string') {
            return res.status(400).json({ error: 'Message is required and must be a string.' });
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
            return res.status(discordResponse.status).json({ error: `Discord API Error: ${errorBody.message || 'Unknown error'}` });
        }

        res.status(200).json({ success: true, message: 'Message sent to Discord.' });

    } catch (error) {
        console.error('Failed to send message to Discord:', error);
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
        res.status(500).json({ error: `An internal error occurred while sending the message: ${errorMessage}` });
    }
}
