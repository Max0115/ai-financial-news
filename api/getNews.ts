
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

    const apiKey = process.env.API_KEY;

    if (!apiKey) {
        console.error('API_KEY environment variable is not set.');
        return res.status(500).json({ error: 'Server configuration error: API_KEY is missing.' });
    }

    try {
        let newsContent: string;
        // Increase limit to get a better selection
        const ARTICLE_LIMIT = 15;

        // Use different proxies based on the source for better reliability
        if (feedUrl.includes("reuters.com")) {
            // Use a reliable CORS proxy for the Reuters JSON API
            const PROXY_URL = `https://corsproxy.io/?${encodeURIComponent(feedUrl)}`;
            const response = await fetch(PROXY_URL);
            if (!response.ok) {
                throw new Error(`Failed to fetch Reuters data from proxy. Status: ${response.status}`);
            }
            const json = await response.json();
            newsContent = json.result.articles.slice(0, ARTICLE_LIMIT).map((item: any) =>
                `Title: ${item.title}\nDescription: ${item.description || ''}\nLink: ${item.canonical_url || ''}\nPublishedAt: ${item.published_at || ''}`
            ).join("\n\n---\n\n");
        } else {
            // Use rss2json for standard RSS feeds, which is more stable
            const PROXY_URL = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feedUrl)}`;
            const response = await fetch(PROXY_URL);
             if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to fetch from rss2json proxy. Status: ${response.status}. Body: ${errorText}`);
            }
            const json = await response.json();

            if (json.status !== 'ok') {
                throw new Error(`rss2json API error: ${json.message}`);
            }
            
            if (!json.items || json.items.length === 0) {
                 return res.status(200).json([]);
            }

            newsContent = json.items.slice(0, ARTICLE_LIMIT).map((item: any) => {
                const rawDescription = item.description || '';
                const cleanDescription = rawDescription.replace(/<[^>]*>?/gm, '').substring(0, 500);
                return `Title: ${item.title || 'No Title'}\nDescription: ${cleanDescription}\nLink: ${item.link || '#'}\nPublishedAt: ${item.pubDate || ''}`;
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
                    eventName: { type: Type.STRING, description: "主要事件或新聞標題，已翻譯成口語化的繁體中文。" },
                    summary: { type: Type.STRING, description: "新聞的簡短中立摘要（約2-3句話），已翻譯成口語化的繁體中文。" },
                    importance: { type: Type.STRING, enum: ["High", "Medium", "Low"], description: "潛在的市場影響力：高、中或低。" },
                    link: { type: Type.STRING, description: "原始新聞文章的URL。" },
                    publicationDate: { type: Type.STRING, description: "新聞的發布日期，格式為ISO 8601字符串。" },
                },
                required: ["eventName", "summary", "importance", "link", "publicationDate"],
            },
        };
        const prompt = `請從以下財經新聞列表中，選出最重要的五則新聞。針對這五則新聞，請執行以下任務：
1. 將 eventName (事件名稱) 和 summary (摘要) 翻譯成自然流暢、口語化的繁體中文。
2. 保持 importance (重要性)、link (原始連結) 和 publicationDate (發布日期) 不變。
3. 最終請以 JSON 陣列的格式回傳這五則經過處理的新聞，並嚴格遵守提供的 schema。如果提供的新聞少于五則，請處理所有新聞。

這是新聞列表：\n\n${newsContent}`;

        const genAIResponse = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: schema,
            },
        });
        
        // Clean and parse the JSON response from Gemini
        const jsonResponseText = genAIResponse.text.trim();
        if (!jsonResponseText) {
             console.warn("Gemini API returned an empty response.");
             return res.status(200).json([]);
        }

        const result = JSON.parse(jsonResponseText);
        res.status(200).json(result);

    } catch (error) {
        console.error("Error in /api/getNews:", error);
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
        res.status(500).json({ error: `Internal Server Error: ${errorMessage}` });
    }
}