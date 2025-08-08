// Placed in /api/getDashboardData.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI, Type } from "@google/genai";

// --- Helper Functions ---

async function getNewsFromSource(feedUrl: string) {
    const ARTICLE_LIMIT = 15;
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

async function getNewsAndCalendarAnalysis(ai: GoogleGenAI, financialNewsContent: string, cryptoNewsContent: string) {
    const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    const todayStr = today.toISOString().split('T')[0];

    const newsItemSchema = { type: Type.OBJECT, properties: { eventName: { type: Type.STRING }, summary: { type: Type.STRING }, importance: { type: Type.STRING, enum: ["High", "Medium", "Low"] }, link: { type: Type.STRING } }, required: ["eventName", "summary", "importance", "link"] };
    const calendarItemSchema = { type: Type.OBJECT, properties: { date: { type: Type.STRING }, time: { type: Type.STRING }, country: { type: Type.STRING }, eventName: { type: Type.STRING }, importance: { type: Type.STRING, enum: ["High"] } }, required: ["date", "time", "country", "eventName", "importance"] };
    const combinedSchema = { type: Type.OBJECT, properties: { financialNews: { type: Type.ARRAY, items: newsItemSchema }, cryptoNews: { type: Type.ARRAY, items: newsItemSchema }, calendar: { type: Type.ARRAY, items: calendarItemSchema } }, required: ["financialNews", "cryptoNews", "calendar"] };

    const prompt = `請同時執行以下三項任務，並將所有結果合併為一個 JSON 物件回傳。

1.  **分析主要財經新聞**: 從提供的主要財經新聞列表中，選出最重要的五則。將內容翻譯成自然流暢的繁體中文。保留 'importance' 和 'link'。新聞列表:
    ---START---
    ${financialNewsContent || "沒有提供新聞內容"}
    ---END---

2.  **分析加密貨幣新聞**: 從提供的加密貨幣新聞列表中，選出最重要的五則。將內容翻譯成自然流暢的繁體中文。保留 'importance' 和 'link'。新聞列表:
    ---START---
    ${cryptoNewsContent || "沒有提供新聞內容"}
    ---END---

3.  **獲取財經日曆**: 今天是 ${todayStr}。請提供未來一週內全球最重要的財經事件日曆。只回傳重要性為 'High' 的事件，包含日期、時間(台灣時間 UTC+8)、國家代碼、事件名稱。

請嚴格遵守提供的 JSON schema 格式。`;

    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash", contents: prompt,
        config: { responseMimeType: "application/json", responseSchema: combinedSchema },
    });
    
    const data = JSON.parse(response.text.trim());
    if (Array.isArray(data.calendar)) {
        data.calendar.sort((a:any, b:any) => {
            const dateA = new Date(`${a.date}T${a.time || '00:00'}`);
            const dateB = new Date(`${b.date}T${b.time || '00:00'}`);
            return dateA.getTime() - dateB.getTime();
        });
    }
    return data;
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
        
        return {
            schedule: parsedData.schedule || [],
            topPost: parsedData.topPost || { postContent: "", url: "" }
        };
    } catch (e) {
        console.error("Error fetching or parsing Trump tracker data:", e);
        return { schedule: [], topPost: { postContent: "", url: "" } };
    }
}

async function getCryptoTechnicalAnalysis(ai: GoogleGenAI, coin: { name: string, ticker: string }) {
    const prompt = `請使用 Google 搜尋獲取最新的 ${coin.name} (${coin.ticker}/USD) 日線級別的市場數據，並基於這些數據進行技術分析。請提供以下資訊，並嚴格以 JSON 物件格式回傳，不要包含任何 json markdown block:

1.  **dataSource**: 簡要說明您分析所基於的數據來源或時間範圍 (例如 "Coinbase 2024-07-30 日線圖")。
2.  **marketStructure**: 對當前市場結構的簡要分析 (例如 "處於上升趨勢中的盤整階段" 或 "跌破關鍵支撐，呈現看跌結構")。
3.  **keyLevels**: 一個物件，包含以下幾個潛在的關鍵價位陣列 (如果不存在則回傳空陣列):
    *   "liquidityPools": ["$XXXX", "$YYYY"] (主要的流動性池)。
    *   "orderBlocks": ["$XXXX - $YYYY (看漲)", "$ZZZZ - $WWWW (看跌)"] (潛在的訂單塊)。
    *   "fairValueGaps": ["$AAAA - $BBBB"] (明顯的公允價值缺口 FVG)。
4.  **bullishScenario**: 看漲劇本的詳細描述。
5.  **bearishScenario**: 看跌劇本的詳細描述。

請確保所有欄位都以繁體中文填寫，並且 JSON 格式正確無誤。
`;

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: { tools: [{ googleSearch: {} }] }
        });

        const cleanedText = response.text.trim().replace(/```json|```/g, "");
        const parsedData = JSON.parse(cleanedText);
        
        if (!parsedData.marketStructure || !parsedData.bullishScenario) {
            throw new Error(`Parsed data from Gemini is missing required fields for ${coin.ticker}.`);
        }
        
        return parsedData;

    } catch (e) {
        console.error(`Error getting ${coin.ticker} analysis:`, e);
        return {
            error: true,
            message: e instanceof Error ? e.message : `無法生成 ${coin.ticker} 分析報告。`,
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
        const [financialNewsContent, cryptoNewsContent] = await Promise.all([
            getNewsFromSource("https://www.investing.com/rss/news_25.rss"),
            getNewsFromSource("https://www.investing.com/rss/news_301.rss")
        ]);

        const [newsAndCalendarData, trumpTrackerData, ethAnalysisData, btcAnalysisData] = await Promise.all([
            getNewsAndCalendarAnalysis(ai, financialNewsContent, cryptoNewsContent),
            getTrumpTracker(ai),
            getCryptoTechnicalAnalysis(ai, { name: 'Ethereum', ticker: 'ETH' }),
            getCryptoTechnicalAnalysis(ai, { name: 'Bitcoin', ticker: 'BTC' })
        ]);

        const dashboardData = {
            ...newsAndCalendarData,
            trumpTracker: trumpTrackerData,
            cryptoAnalysis: {
                eth: ethAnalysisData,
                btc: btcAnalysisData,
            },
        };

        res.status(200).json(dashboardData);

    } catch (error) {
        console.error("Error in /api/getDashboardData:", error);
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
        res.status(500).json({ error: `Internal Server Error: ${errorMessage}` });
    }
}