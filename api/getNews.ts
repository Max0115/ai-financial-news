// Placed in /api/getNews.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI, Type } from "@google/genai";

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Set CORS headers to allow requests from any origin
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle OPTIONS preflight request for CORS
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    const { feedUrl } = req.query;

    if (!feedUrl || typeof feedUrl !== 'string') {
        return res.status(400).json({ error: "Missing or invalid feedUrl query parameter." });
    }

    const PROXY_URL = `https://api.allorigins.win/raw?url=${encodeURIComponent(feedUrl)}`;
    const apiKey = process.env.API_KEY;

    if (!apiKey) {
        console.error('API_KEY environment variable is not set.');
        return res.status(500).json({ error: 'Server configuration error: API_KEY is missing.' });
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
                `Title: ${item.title}\nDescription: ${item.description || ''}\nLink: ${item.canonical_url || ''}`
            ).join("\n\n---\n\n");
        } else { // Assume XML-based feeds
            const items = rawText.match(/<item>[\s\S]*?<\/item>/g) || [];
            if (items.length === 0) {
                 return res.status(200).json([]);
            }
            newsContent = items.slice(0, 8).map(item => {
                const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s);
                const title = titleMatch ? titleMatch[1].trim() : 'No Title';

                const linkMatch = item.match(/<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/s);
                const link = linkMatch ? linkMatch[1].trim() : '#';
                
                const descriptionMatch = item.match(/<description>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/s);
                const rawDescription = descriptionMatch ? descriptionMatch[1].trim() : '';
                const cleanDescription = rawDescription.replace(/<[^>]*>?/gm, '').substring(0, 500);

                return `Title: ${title}\nDescription: ${cleanDescription}\nLink: ${link}`;
            }).join("\n\n---\n\n");
        }

        if (!newsContent.trim()) {
            return res.status(200).json([]);
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
                    link: { type: Type.STRING, description: "The original URL of the news article." },
                },
                required: ["eventName", "summary", "importance", "link"],
            },
        };
        const prompt = `Analyze the following financial news items. For each item, provide the event name, a short summary, its market importance (High, Medium, or Low), and its original link. Provide the output as a JSON array of objects based on the requested schema. Here are the news items:\n\n${newsContent}`;

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
        res.status(200).json(result);

    } catch (error) {
        console.error("Error in /api/getNews:", error);
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
        res.status(500).json({ error: `Internal Server Error: ${errorMessage}` });
    }
}