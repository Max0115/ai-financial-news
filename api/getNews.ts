// Placed in /api/getNews.ts
import type { IncomingMessage, ServerResponse } from "http";
import { GoogleGenAI, Type } from "@google/genai";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
    // Set CORS headers to allow requests from any origin
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle OPTIONS preflight request for CORS
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

    const url = new URL(req.url!, `http://${req.headers.host}`);
    const feedUrl = url.searchParams.get('feedUrl');

    if (!feedUrl) {
        return sendJson(400, { error: "Missing feedUrl query parameter." });
    }

    const PROXY_URL = `https://api.allorigins.win/raw?url=${encodeURIComponent(feedUrl)}`;
    const apiKey = process.env.API_KEY;

    if (!apiKey) {
        console.error('API_KEY environment variable is not set.');
        return sendJson(500, { error: 'Server configuration error: API_KEY is missing.' });
    }

    try {
        // 1. Fetch RSS Feed
        const response = await fetch(PROXY_URL);
        if (!response.ok) {
            throw new Error(`Failed to fetch RSS feed from proxy. Status: ${response.status}`);
        }
        const rawText = await response.text();

        // 2. Parse content based on source format
        let newsContent: string;
        if (feedUrl.includes("reuters.com")) {
            const json = JSON.parse(rawText);
            newsContent = json.result.articles.slice(0, 8).map((item: any) =>
                `Title: ${item.title}\nDescription: ${item.description || ''}`
            ).join("\n\n---\n\n");
        } else { // Assume XML-based feeds
            const items = rawText.match(/<item>[\s\S]*?<\/item>/g) || [];
            if (items.length === 0) {
                 return sendJson(200, []);
            }
            newsContent = items.slice(0, 8).map(item => {
                const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s);
                const title = titleMatch ? titleMatch[1].trim() : 'No Title';
                
                const descriptionMatch = item.match(/<description>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/s);
                const rawDescription = descriptionMatch ? descriptionMatch[1].trim() : '';
                const cleanDescription = rawDescription.replace(/<[^>]*>?/gm, '').substring(0, 500);

                return `Title: ${title}\nDescription: ${cleanDescription}`;
            }).join("\n\n---\n\n");
        }

        if (!newsContent.trim()) {
            return sendJson(200, []);
        }

        // 3. Call Gemini API for analysis
        const ai = new GoogleGenAI({ apiKey });
        const schema = {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    eventName: { type: Type.STRING, description: "The main event or news title, concisely summarized." },
                    summary: { type: Type.STRING, description: "A brief, neutral summary of the news (2-3 sentences)." },
                    importance: { type: Type.STRING, enum: ["High", "Medium", "Low"], description: "The potential market impact: High, Medium, or Low." },
                },
                required: ["eventName", "summary", "importance"],
            },
        };
        const prompt = `Analyze the following financial news items. For each item, provide the event name, a short summary, and its market importance (High, Medium, or Low). Provide the output as a JSON array of objects based on the requested schema. Here are the news items:\n\n${newsContent}`;

        const genAIResponse = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: schema,
            },
        });
        
        // Clean and parse the JSON response from Gemini
        const jsonResponseText = genAIResponse.text.trim().replace(/^```json\s*/, '').replace(/```$/, '');
        const result = JSON.parse(jsonResponseText);
        sendJson(200, result);

    } catch (error) {
        console.error("Error in /api/getNews:", error);
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
        sendJson(500, { error: `Internal Server Error: ${errorMessage}` });
    }
}