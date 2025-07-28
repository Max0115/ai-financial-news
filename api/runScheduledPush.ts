
// Placed in /api/runScheduledPush.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI, Type } from "@google/genai";

// --- Helper Functions (copied from getDashboardData) ---

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
3. 最終請以 JSON 陣列的格式回傳這五則經過處理的新聞。
新聞列表：\n\n${newsContent}`;

    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash", contents: prompt,
        config: { responseMimeType: "application/json", responseSchema: schema },
    });
    return JSON.parse(response.text.trim());
}

async function getFinancialCalendar(ai: GoogleGenAI) {
    const schema = { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { date: { type: Type.STRING }, time: { type: Type.STRING }, country: { type: Type.STRING }, eventName: { type: Type.STRING }, importance: { type: Type.STRING, enum: ["High", "Medium", "Low"] } }, required: ["date", "time", "country", "eventName", "importance"] } };
    const prompt = `請提供未來一週內（從今天開始）全球最重要的財經事件日曆。請包含日期（YYYY-MM-DD）、時間（HH:MM，24小時制）、國家/地區的 ISO 3166-1 alpha-2 代碼、事件的繁體中文名稱和重要性（High, Medium, Low）。時間請轉換為台灣時間（UTC+8）。以 JSON 格式回傳。`;
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash", contents: prompt,
            config: { responseMimeType: "application/json", responseSchema: schema },
        });
        return JSON.parse(response.text.trim());
    } catch (e) { console.error("Error fetching financial calendar:", e); return []; }
}

async function getTrumpTracker(ai: GoogleGenAI) {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const scheduleSchema = { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { date: { type: Type.STRING }, time: { type: Type.STRING }, eventDescription: { type: Type.STRING } }, required: ["date", "eventDescription"] } };
    const schedulePrompt = `請使用 Google 搜尋，找出唐納·川普在今天 (${today}) 和明天兩天內的公開行程、集會或重要演講。以繁體中文和 JSON 格式回傳，包含日期（YYYY-MM-DD）、時間（當地時間，註明時區，若無則為 '全天'）和事件描述。若無行程，回傳空陣列 []。`;
    
    const postSchema = { type: Type.OBJECT, properties: { postContent: { type: Type.STRING }, url: { type: Type.STRING } }, required: ["postContent", "url"] };
    const postPrompt = `請使用 Google 搜尋，找出唐納·川普今日 (${today}) 在 Truth Social 上引起最多關注或報導的貼文內容。將內容翻譯成繁體中文，並提供一個相關的新聞報導或來源 URL。以 JSON 格式回傳。若無，回傳含空字串的物件。`;

    let schedule = [], topPost = { postContent: "", url: "" };
    try {
        const scheduleResponse = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: schedulePrompt, config: { tools: [{ googleSearch: {} }], responseMimeType: "application/json", responseSchema: scheduleSchema } });
        schedule = JSON.parse(scheduleResponse.text.trim());
    } catch (e) { console.error("Error fetching Trump schedule:", e); }
    try {
        const postResponse = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: postPrompt, config: { tools: [{ googleSearch: {} }], responseMimeType: "application/json", responseSchema: postSchema } });
        topPost = JSON.parse(postResponse.text.trim());
    } catch(e) { console.error("Error fetching Trump post:", e); }
    return { schedule, topPost };
}

async function sendComprehensiveDiscordMessage(webhookUrl: string, data: any) {
    const { financialNews, cryptoNews, calendar, trumpTracker } = data;
    if ([financialNews, cryptoNews, calendar, trumpTracker].every(d => !d || d.length === 0)) return;
    
    const getCountryFlag = (code: string) => ({'US':'🇺🇸','CN':'🇨🇳','JP':'🇯🇵','DE':'🇩🇪','GB':'🇬🇧','EU':'🇪🇺','FR':'🇫🇷','IT':'🇮🇹','CA':'🇨🇦','AU':'🇦🇺','NZ':'🇳🇿','CH':'🇨🇭'}[code.toUpperCase()]||'🏳️');
    const getImportanceEmoji = (imp: string) => ({'High':'🔥','Medium':'⚠️','Low':'✅'}[imp]||'');
    
    let content = `**AI 每日財經洞察 (${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })})**\n\n`;
    if (financialNews?.length > 0) {
        content += `--- 📰 **主要財經新聞** ---\n\n`;
        financialNews.forEach((a:any) => { content += `> **[${a.eventName}](${a.link})** (${a.importance})\n> ${a.summary}\n\n`; });
    }
    if (cryptoNews?.length > 0) {
        content += `--- 📈 **加密貨幣新聞** ---\n\n`;
        cryptoNews.forEach((a:any) => { content += `> **[${a.eventName}](${a.link})** (${a.importance})\n> ${a.summary}\n\n`; });
    }
    if (calendar?.length > 0) {
        content += `--- 🗓️ **本週財經日曆** ---\n\n`;
        calendar.slice(0, 7).forEach((e:any) => { content += `> **${e.date.substring(5)} ${e.time}** ${getCountryFlag(e.country)} ${e.eventName} (${getImportanceEmoji(e.importance)} ${e.importance})\n`; });
        content += `\n`;
    }
    if (trumpTracker) {
        content += `--- 🦅 **川普動態** ---\n\n`;
        if (trumpTracker.schedule?.length > 0) {
            content += `> **🎤 行程與演講:**\n`;
            trumpTracker.schedule.forEach((i:any) => { content += `> - **${i.date.substring(5)} ${i.time}:** ${i.eventDescription}\n`; });
        }
        if (trumpTracker.topPost?.postContent) {
             content += `> **💬 [Truth Social 熱門](${trumpTracker.topPost.url}):**\n> "${trumpTracker.topPost.postContent}"\n`;
        }
    }

    const res = await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
    if (!res.ok) { const err = await res.json(); throw new Error(`Discord API Error: ${err.message || 'Unknown'}`); }
}

// --- Main Handler ---

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.headers['x-vercel-cron-secret'] !== process.env.CRON_SECRET) {
      return res.status(401).send('Unauthorized');
    }
    
    const apiKey = process.env.API_KEY;
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!apiKey || !webhookUrl) {
        console.error('Missing environment variables.');
        return res.status(500).json({ error: 'Server configuration error.' });
    }

    const ai = new GoogleGenAI({ apiKey });

    try {
        console.log("Cron job started: Fetching all dashboard data...");
        
        const [
            financialNewsContent, cryptoNewsContent, calendarData, trumpTrackerData
        ] = await Promise.all([
            getNewsFromSource("https://www.investing.com/rss/news_25.rss"),
            getNewsFromSource("https://www.investing.com/rss/news_301.rss"),
            getFinancialCalendar(ai),
            getTrumpTracker(ai)
        ]);
        
        const [financialNews, cryptoNews] = await Promise.all([
            analyzeNews(ai, financialNewsContent),
            analyzeNews(ai, cryptoNewsContent)
        ]);
        
        const allData = { financialNews, cryptoNews, calendar: calendarData, trumpTracker: trumpTrackerData };

        await sendComprehensiveDiscordMessage(webhookUrl, allData);
        
        console.log("Successfully sent comprehensive summary to Discord.");
        res.status(200).json({ success: true, message: 'Scheduled push completed successfully.' });

    } catch (error) {
        console.error("Error in scheduled push:", error);
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
        res.status(500).json({ error: `Internal Server Error: ${errorMessage}` });
    }
}
