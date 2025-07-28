
// Placed in /api/getDashboardData.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI, Type } from "@google/genai";

// --- Helper Functions (can be shared with runScheduledPush) ---

async function getNewsFromSource(feedUrl: string) {
    const ARTICLE_LIMIT = 15;
    if (feedUrl.includes("reuters.com")) {
        const PROXY_URL = `https://corsproxy.io/?${encodeURIComponent(feedUrl)}`;
        const response = await fetch(PROXY_URL);
        if (!response.ok) throw new Error(`Failed to fetch Reuters from proxy. Status: ${response.status}`);
        const json = await response.json();
        return json.result.articles.slice(0, ARTICLE_LIMIT).map((item: any) =>
            `Title: ${item.title}\nDescription: ${item.description || ''}\nLink: ${item.canonical_url || ''}\nPublishedAt: ${item.published_at || ''}`
        ).join("\n\n---\n\n");
    } else {
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
    const schema = { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { date: { type: Type.STRING }, time: { type: Type.STRING }, country: { type: Type.STRING }, eventName: { type: Type.STRING }, importance: { type: Type.STRING, enum: ["High", "Medium", "Low"] } }, required: ["date", "time", "country", "eventName", "importance"] } };
    const prompt = `請提供未來一週內（從今天開始）全球最重要的財經事件日曆。請包含日期（YYYY-MM-DD）、時間（HH:MM，24小時制）、國家/地區的 ISO 3166-1 alpha-2 代碼（例如 US, EU, CN）、事件的繁體中文名稱和重要性（High, Medium, Low）。時間請轉換為台灣時間（UTC+8）。以 JSON 格式回傳。`;
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash", contents: prompt,
            config: { responseMimeType: "application/json", responseSchema: schema },
        });
        return JSON.parse(response.text.trim());
    } catch (e) { console.error("Error fetching financial calendar:", e); return []; }
}

async function getTrumpTracker(ai: GoogleGenAI) {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // Get date in YYYY-MM-DD format for US
    const scheduleSchema = { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { date: { type: Type.STRING }, time: { type: Type.STRING }, eventDescription: { type: Type.STRING } }, required: ["date", "eventDescription"] } };
    const schedulePrompt = `請使用 Google 搜尋，找出唐納·川普在今天 (${today}) 和明天兩天內的公開行程、集會或重要演講。以繁體中文和 JSON 格式回傳，包含日期（YYYY-MM-DD）、時間（當地時間，註明時區，若無則為 '全天'）和事件描述。如果沒有找到行程，請回傳空陣列 []。`;
    
    const postSchema = { type: Type.OBJECT, properties: { postContent: { type: Type.STRING }, url: { type: Type.STRING } }, required: ["postContent", "url"] };
    const postPrompt = `請使用 Google 搜尋，找出唐納·川普今日 (${today}) 在 Truth Social 上引起最多關注或報導的貼文內容。將內容翻譯成繁體中文，並提供一個相關的新聞報導或來源 URL。以 JSON 格式回傳。如果沒有找到，回傳一個包含空字串的物件。`;

    let schedule = [], topPost = { postContent: "", url: "" };
    
    try {
        const scheduleResponse = await ai.models.generateContent({
            model: "gemini-2.5-flash", contents: schedulePrompt,
            config: { tools: [{ googleSearch: {} }], responseMimeType: "application/json", responseSchema: scheduleSchema }
        });
        schedule = JSON.parse(scheduleResponse.text.trim());
    } catch (e) { console.error("Error fetching Trump schedule:", e); }

    try {
        const postResponse = await ai.models.generateContent({
            model: "gemini-2.5-flash", contents: postPrompt,
            config: { tools: [{ googleSearch: {} }], responseMimeType: "application/json", responseSchema: postSchema }
        });
        topPost = JSON.parse(postResponse.text.trim());
    } catch(e) { console.error("Error fetching Trump post:", e); }
    
    return { schedule, topPost };
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
