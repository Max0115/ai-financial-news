
// Placed in /api/getDashboardData.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI, Type } from "@google/genai";

// --- Helper Functions (can be shared with runScheduledPush) ---

async function getNewsFromSource(feedUrl: string) {
    const ARTICLE_LIMIT = 15;
    // rss2json is more reliable for various feeds
    const PROXY_URL = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feedUrl)}`;
    const response = await fetch(PROXY_URL);
    if (!response.ok) throw new Error(`Failed to fetch from rss2json. Status: ${response.status}`);
    const json = await response.json();
    if (json.status !== 'ok' || !json.items) return "";
    return json.items.slice(0, ARTICLE_LIMIT).map((item: any) => {
        const cleanDescription = (item.description || '').replace(/<[^>]*>?/gm, '').substring(0, 500);
        return `Title: ${item.title || 'No Title'}\nDescription: ${cleanDescription}\nLink: ${item.link || '#'}\nPublishedAt: ${item.pubDate || ''}`;
    }).join("\n\n---\n\n");
}

async function analyzeNews(ai: GoogleGenAI, newsContent: string) {
    if (!newsContent.trim()) return [];
    const schema = { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { eventName: { type: Type.STRING }, summary: { type: Type.STRING }, importance: { type: Type.STRING, enum: ["High", "Medium", "Low"] }, link: { type: Type.STRING } }, required: ["eventName", "summary", "importance", "link"] } };
    const prompt = `請從以下財經新聞列表中，選出最重要的五則新聞。針對這五則新聞，請執行以下任務：
1. 將 eventName (事件名稱) 和 summary (摘要) 翻譯成自然流暢、口語化的繁體中文。
2. 保持 importance (重要性) 和 link (原始連結) 不變。
3. 最終請以 JSON 陣列的格式回傳這五則經過處理的新聞，並嚴格遵守提供的 schema。如果提供的新聞少于五則，請處理所有新聞。
新聞列表：\n\n${newsContent}`;

    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: { responseMimeType: "application/json", responseSchema: schema },
    });
    return JSON.parse(response.text.trim());
}

async function getFinancialCalendar(ai: GoogleGenAI) {
    const schema = { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { date: { type: Type.STRING }, time: { type: Type.STRING }, country: { type: Type.STRING }, eventName: { type: Type.STRING }, importance: { type: Type.STRING, enum: ["High"] } }, required: ["date", "time", "country", "eventName", "importance"] } };
    
    const today = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Taipei"}));
    const todayStr = today.toISOString().split('T')[0];
    
    const prompt = `今天是 ${todayStr}。請提供未來一週內（從今天開始）全球最重要的財經事件日曆。請包含日期（YYYY-MM-DD）、時間（HH:MM，24小時制，台灣時間 UTC+8）、國家/地區的 ISO 3166-1 alpha-2 代碼（例如 US, EU, CN）、事件的繁體中文名稱和重要性。**只回傳重要性為 'High' 的事件。** 以 JSON 格式回傳。`;
    
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash", contents: prompt,
            config: { responseMimeType: "application/json", responseSchema: schema },
        });
        let events = JSON.parse(response.text.trim());
        
        if (Array.isArray(events)) {
            // Safeguard filter
            events = events.filter(e => e.importance === 'High');
            // Sort events chronologically
            events.sort((a, b) => {
                const dateA = new Date(`${a.date}T${a.time || '00:00'}`);
                const dateB = new Date(`${b.date}T${b.time || '00:00'}`);
                return dateA.getTime() - dateB.getTime();
            });
        }
        
        return events;
    } catch (e) { console.error("Error fetching financial calendar:", e); return []; }
}


async function getTrumpTracker(ai: GoogleGenAI) {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const prompt = `今天是 ${today}。請使用 Google 搜尋，綜合執行以下兩項任務，並將結果合併成一個 JSON 物件回傳：
1.  **行程**: 找出唐納·川普在今天 (${today}) 和明天兩天內的公開行程、集會或重要演講。
2.  **最新貼文**: 找出唐納·川普在 Truth Social 官方帳號 (@realDonaldTrump) 上**今日最新**的一則貼文。請提供貼文的繁體中文翻譯內容和貼文的直接 URL。

請嚴格遵循以下 JSON 格式：
{
  "schedule": [ { "date": "YYYY-MM-DD", "time": "HH:MM (時區)", "eventDescription": "..." } ],
  "topPost": { "postContent": "貼文內容...", "url": "..." }
}

如果找不到行程，"schedule" 應為空陣列 []。
如果找不到今日貼文，"topPost" 中的 "postContent" 和 "url" 應為空字串。`;

    try {
        console.log("Fetching Trump tracker data (schedule and post)...");
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: { tools: [{ googleSearch: {} }] }
        });
        const cleanedText = response.text.trim().replace(/```json|```/g, "");
        const parsedData = JSON.parse(cleanedText);
        
        // Ensure the structure is correct even if the model messes up
        return {
            schedule: parsedData.schedule || [],
            topPost: parsedData.topPost || { postContent: "", url: "" }
        };

    } catch (e) {
        console.error("Error fetching or parsing Trump tracker data:", e);
        // Return a default structure on failure to prevent frontend errors
        return {
            schedule: [],
            topPost: { postContent: "", url: "" }
        };
    }
}

// --- Main Handler ---

export default async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const apiKey = process.env.API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'Server configuration error: API_KEY is missing.' });
    }

    const ai = new GoogleGenAI({ apiKey });

    try {
        const financialFeedUrl = "https://www.investing.com/rss/news_25.rss";
        const cryptoFeedUrl = "https://www.investing.com/rss/news_301.rss";

        // Fetch all data in parallel
        const [
            financialNewsContent,
            cryptoNewsContent,
            calendarData,
            trumpTrackerData
        ] = await Promise.all([
            getNewsFromSource(financialFeedUrl),
            getNewsFromSource(cryptoFeedUrl),
            getFinancialCalendar(ai),
            getTrumpTracker(ai)
        ]);

        const [financialNews, cryptoNews] = await Promise.all([
            analyzeNews(ai, financialNewsContent),
            analyzeNews(ai, cryptoNewsContent)
        ]);
        
        const dashboardData = {
            financialNews,
            cryptoNews,
            calendar: calendarData,
            trumpTracker: trumpTrackerData
        };

        res.status(200).json(dashboardData);

    } catch (error) {
        console.error("Error in /api/getDashboardData:", error);
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
        res.status(500).json({ error: `Internal Server Error: ${errorMessage}` });
    }
}
