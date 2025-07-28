// Placed in /api/runScheduledPush.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI, Type } from "@google/genai";

// 共享的邏輯函數，也可以從其他文件中導入
async function getNewsFromSource(feedUrl: string) {
    let newsContent: string;
    const ARTICLE_LIMIT = 10;

    if (feedUrl.includes("reuters.com")) {
        const PROXY_URL = `https://corsproxy.io/?${encodeURIComponent(feedUrl)}`;
        const response = await fetch(PROXY_URL);
        if (!response.ok) throw new Error(`Failed to fetch Reuters data from proxy. Status: ${response.status}`);
        const json = await response.json();
        newsContent = json.result.articles.slice(0, ARTICLE_LIMIT).map((item: any) =>
            `Title: ${item.title}\nDescription: ${item.description || ''}\nLink: ${item.canonical_url || ''}\nPublishedAt: ${item.published_at || ''}`
        ).join("\n\n---\n\n");
    } else {
        const PROXY_URL = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feedUrl)}`;
        const response = await fetch(PROXY_URL);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to fetch from rss2json proxy. Status: ${response.status}. Body: ${errorText}`);
        }
        const json = await response.json();
        if (json.status !== 'ok' || !json.items || json.items.length === 0) {
            return null;
        }
        newsContent = json.items.slice(0, ARTICLE_LIMIT).map((item: any) => {
            const cleanDescription = (item.description || '').replace(/<[^>]*>?/gm, '').substring(0, 500);
            return `Title: ${item.title || 'No Title'}\nDescription: ${cleanDescription}\nLink: ${item.link || '#'}\nPublishedAt: ${item.pubDate || ''}`;
        }).join("\n\n---\n\n");
    }
    return newsContent;
}

async function analyzeWithGemini(apiKey: string, newsContent: string) {
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
    const prompt = `請從以下財經新聞列表中，選出最重要的四則新聞。針對這四則新聞，請執行以下任務：
1. 將 eventName (事件名稱) 和 summary (摘要) 翻譯成自然流暢、口語化的繁體中文。
2. 保持 importance (重要性)、link (原始連結) 和 publicationDate (發布日期) 不變。
3. 最終請以 JSON 陣列的格式回傳這四則經過處理的新聞，並嚴格遵守提供的 schema。如果提供的新聞少于四則，請處理所有新聞。

這是新聞列表：\n\n${newsContent}`;

    const genAIResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: { responseMimeType: "application/json", responseSchema: schema },
    });
    const jsonResponseText = genAIResponse.text.trim();
    return jsonResponseText ? JSON.parse(jsonResponseText) : [];
}

async function sendToDiscord(webhookUrl: string, articles: any[], feedName: string) {
    if (articles.length === 0) return;
    let content = `**${feedName} - AI 自動摘要 (${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })})**\n\n`;
    articles.forEach(article => {
        content += `> **[${article.eventName}](${article.link})** (${article.importance})\n> ${article.summary}\n\n`;
    });

    const discordResponse = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
    });

    if (!discordResponse.ok) {
        const errorBody = await discordResponse.json();
        throw new Error(`Discord API Error: ${errorBody.message || 'Unknown error'}`);
    }
}


export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Log every invocation attempt to see if the cron is firing at all.
    console.log(`Cron job invocation received at: ${new Date().toISOString()}`);

    // --- Security Check ---
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
        console.error("CRON_SECRET environment variable is not set. Aborting cron job.");
        // Return 500 because this is a server configuration error, not an auth failure.
        return res.status(500).send('Server configuration error: CRON_SECRET is not set.');
    }
    
    const requestSecret = req.headers['x-vercel-cron-secret'];
    if (requestSecret !== cronSecret) {
      console.error(`Unauthorized cron job access attempt. Expected secret: ...${cronSecret.slice(-4)}, Received: ${typeof requestSecret === 'string' ? '...' + requestSecret.slice(-4) : 'undefined'}`);
      return res.status(401).send('Unauthorized');
    }
    
    // --- End Security Check ---

    console.log("Cron job authorized. Proceeding with execution.");
    
    const apiKey = process.env.API_KEY;
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

    if (!apiKey || !webhookUrl) {
        console.error('Environment variables API_KEY or DISCORD_WEBHOOK_URL are not set.');
        return res.status(500).json({ error: 'Server configuration error.' });
    }

    try {
        // Default feed for the cron job
        const defaultFeed = { name: "Investing.com - 主要新聞", url: "https://www.investing.com/rss/news_25.rss" };
        
        console.log(`Cron job started: Fetching news from ${defaultFeed.name}`);
        
        const newsContent = await getNewsFromSource(defaultFeed.url);
        if (!newsContent || !newsContent.trim()) {
            console.log("No news content fetched. Exiting job.");
            return res.status(200).json({ message: "No new content to process." });
        }
        
        const analyzedArticles = await analyzeWithGemini(apiKey, newsContent);
        if (analyzedArticles.length === 0) {
            console.log("Gemini did not return any articles. Exiting job.");
            return res.status(200).json({ message: "AI analysis resulted in no articles." });
        }

        await sendToDiscord(webhookUrl, analyzedArticles, defaultFeed.name);
        
        console.log("Successfully sent news summary to Discord.");
        res.status(200).json({ success: true, message: 'Scheduled push completed successfully.' });

    } catch (error) {
        console.error("Error in scheduled push:", error);
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
        res.status(500).json({ error: `Internal Server Error: ${errorMessage}` });
    }
}