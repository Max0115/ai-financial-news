// Placed in /api/runScheduledPush.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI, Type } from "@google/genai";

type RunType = 'morning' | 'evening';

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

async function getNewsAndCalendarAnalysisForPush(ai: GoogleGenAI, financialNewsContent: string, cryptoNewsContent: string, runType: RunType) {
    const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    const todayStr = today.toISOString().split('T')[0];

    const newsItemSchema = { type: Type.OBJECT, properties: { eventName: { type: Type.STRING }, summary: { type: Type.STRING }, importance: { type: Type.STRING, enum: ["High", "Medium", "Low"] }, link: { type: Type.STRING } }, required: ["eventName", "summary", "importance", "link"] };
    const calendarItemSchema = { type: Type.OBJECT, properties: { date: { type: Type.STRING }, time: { type: Type.STRING }, country: { type: Type.STRING }, eventName: { type: Type.STRING }, importance: { type: Type.STRING, enum: ["High"] } }, required: ["date", "time", "country", "eventName", "importance"] };
    const combinedSchema = { type: Type.OBJECT, properties: { financialNews: { type: Type.ARRAY, items: newsItemSchema }, cryptoNews: { type: Type.ARRAY, items: newsItemSchema }, calendar: { type: Type.ARRAY, items: calendarItemSchema } }, required: ["financialNews", "cryptoNews", "calendar"] };

    const eveningInstruction = `\n*   **特別注意**: 請優先選擇下午或晚間發生的新動態，避免與早上已報導過的重大頭條重複。`;
    const newsTaskInstruction = `從提供的新聞列表中，選出最重要的五則。將內容翻譯成自然流暢的繁體中文。保留 'importance' 和 'link'。${runType === 'evening' ? eveningInstruction : ''}`;

    const prompt = `請同時執行以下三項任務，並將所有結果合併為一個 JSON 物件回傳。

1.  **分析主要財經新聞**: ${newsTaskInstruction}
    新聞列表:
    ---START---
    ${financialNewsContent || "沒有提供新聞內容"}
    ---END---

2.  **分析加密貨幣新聞**: ${newsTaskInstruction}
    新聞列表:
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
}

async function getCryptoTechnicalAnalysis(ai: GoogleGenAI, coin: { name: string, ticker: string }) {
    const prompt = `請使用 Google 搜尋獲取最新的 ${coin.name} (${coin.ticker}/USD) 日線級別的市場數據，並基於這些數據進行技術分析。請提供以下資訊，並嚴格以 JSON 物件格式回傳，不要包含任何 json markdown block:

1.  **dataSource**: 簡要說明您分析所基於的數據來源或時間範圍 (例如 "Coinbase 2024-07-30 日線圖")。
2.  **marketStructure**: 對當前市場結構的簡要分析。
3.  **keyLevels**: 一個物件，包含以下幾個潛在的關鍵價位陣列 (如果不存在則回傳空陣列)。
4.  **bullishScenario**: 看漲劇本的詳細描述。
5.  **bearishScenario**: 看跌劇本的詳細描述。
6.  **currentBias**: 一個包含 'sentiment' ('Bullish' 或 'Bearish') 和 'targetRange' (價格區間字串) 的物件。

請在所有價格數字前後加上 **，例如 "**$65,000**" 或 "**$4,000 - $4,100**"。請確保所有欄位都以繁體中文填寫，並且 JSON 格式正確無誤。`;

    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: { tools: [{ googleSearch: {} }] }
    });
    const cleanedText = response.text.trim().replace(/```json|```/g, "");
    let parsedData;
    try {
        parsedData = JSON.parse(cleanedText);
    } catch (parseError) {
         console.error(`Error parsing JSON for ${coin.ticker} in scheduled push:`, cleanedText, parseError);
         throw new Error(`Unexpected token from API for ${coin.ticker}: "${cleanedText.substring(0, 50)}..." is not valid JSON`);
    }
    
    if (!parsedData.marketStructure || !parsedData.bullishScenario || !parsedData.currentBias) {
        throw new Error(`Parsed data from Gemini is missing required fields for ${coin.ticker} analysis.`);
    }
    parsedData.analysisTimestamp = new Date().toISOString();
    return parsedData;
}

async function sendComprehensiveDiscordMessage(webhookUrl: string, data: any, runType: string) {
    const { financialNews, cryptoNews, calendar, trumpTracker, cryptoAnalysis } = data;
    const embeds = [];
    const timestamp = new Date().toISOString();

    if (financialNews?.length > 0) {
        embeds.push({
            title: '📰 主要財經新聞', color: 3447003,
            description: financialNews.map((a: any) => `> **[${a.eventName}](${a.link})** (${a.importance})\n> ${a.summary}`).join('\n\n')
        });
    }
    if (cryptoNews?.length > 0) {
        embeds.push({
            title: '📈 加密貨幣新聞', color: 15844367,
            description: cryptoNews.map((a: any) => `> **[${a.eventName}](${a.link})** (${a.importance})\n> ${a.summary}`).join('\n\n')
        });
    }
    if (calendar?.length > 0) {
        const getCountryFlag = (code: string) => ({'US':'🇺🇸','CN':'🇨🇳','JP':'🇯🇵','DE':'🇩🇪','GB':'🇬🇧','EU':'🇪🇺','FR':'🇫🇷','IT':'🇮🇹','CA':'🇨🇦','AU':'🇦🇺','NZ':'🇳🇿','CH':'🇨🇭'}[code.toUpperCase()]||'🏳️');
        const getImportanceEmoji = (imp: string) => ({'High':'🔥','Medium':'⚠️','Low':'✅'}[imp]||'');
        embeds.push({
            title: '🗓️ 本週重要財經日曆 (High)', color: 5763719,
            description: calendar.slice(0, 10).map((e: any) => `> **${e.date.substring(5)} ${e.time}** ${getCountryFlag(e.country)} ${e.eventName} (${getImportanceEmoji(e.importance)} ${e.importance})`).join('\n')
        });
    }
    if (trumpTracker && !trumpTracker.error) {
        const fields = [];
        if (trumpTracker.schedule?.length > 0) {
            fields.push({ name: '🎤 行程與演講', value: trumpTracker.schedule.map((i: any) => `> - **${i.date.substring(5)} ${i.time}:** ${i.eventDescription}`).join('\n'), inline: false });
        }
        if (trumpTracker.topPost?.postContent) {
            fields.push({ name: '💬 Truth Social 最新貼文', value: `> [原文連結](${trumpTracker.topPost.url})\n> "${trumpTracker.topPost.postContent}"`, inline: false });
        }
        if (fields.length > 0) {
            embeds.push({ title: '🦅 川普動態', color: 15105570, fields });
        }
    }
     if (cryptoAnalysis) {
        const createCryptoEmbed = (analysisData: any, name: string) => {
            if (!analysisData || analysisData.error) return null;
            const { marketStructure, bullishScenario, bearishScenario, dataSource, currentBias, analysisTimestamp } = analysisData;
            const fields = [];
            if (currentBias) {
                 const sentimentEmoji = currentBias.sentiment === 'Bullish' ? '📈' : '📉';
                 fields.push({ name: `當前趨勢: ${currentBias.sentiment} ${sentimentEmoji}`, value: `> 目標區間: ${currentBias.targetRange}`, inline: false });
            }
            if (marketStructure) fields.push({ name: '市場結構', value: `> ${marketStructure}`, inline: false });
            if (bullishScenario) fields.push({ name: '🐂 看漲劇本', value: `> ${bullishScenario}`, inline: false });
            if (bearishScenario) fields.push({ name: '🐻 看跌劇本', value: `> ${bearishScenario}`, inline: false });

            if (fields.length > 0) {
                const formattedTimestamp = new Date(analysisTimestamp).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
                return {
                    title: `📈 ${name} 技術分析`,
                    color: name === 'ETH' ? 6250495 : 16098048, // Purple for ETH, Orange for BTC
                    description: `**數據來源:** ${dataSource || 'AI 綜合分析'}\n**分析時間:** ${formattedTimestamp}`,
                    fields: fields
                };
            }
            return null;
        }
        const btcEmbed = createCryptoEmbed(cryptoAnalysis.btc, 'BTC');
        if (btcEmbed) embeds.push(btcEmbed);

        const ethEmbed = createCryptoEmbed(cryptoAnalysis.eth, 'ETH');
        if (ethEmbed) embeds.push(ethEmbed);
    }
    
    if (embeds.length === 0) {
        console.log("No data to send to Discord.");
        return;
    }
    
    embeds[embeds.length-1].footer = { text: 'AI Financial Insight Dashboard' };
    embeds[embeds.length-1].timestamp = timestamp;
    
    const runTitle = runType === 'morning' ? '上午' : '晚間';

    const payload = {
        content: `**AI 每日${runTitle}財經洞察 (${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })})**`,
        embeds: embeds.slice(0, 10) // Discord limit of 10 embeds
    };

    const res = await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) { const err = await res.json(); throw new Error(`Discord API Error: ${JSON.stringify(err)}`); }
}

// --- Main Handler ---

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.headers['x-vercel-cron-secret'] !== process.env.CRON_SECRET) {
      return res.status(401).send('Unauthorized');
    }
    
    const runType: RunType = req.query.run === 'morning' ? 'morning' : 'evening';

    const apiKey = process.env.API_KEY;
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!apiKey || !webhookUrl) {
        console.error('Missing environment variables.');
        return res.status(500).json({ error: 'Server configuration error.' });
    }

    const ai = new GoogleGenAI({ apiKey });

    try {
        console.log(`Cron job started for ${runType} run: Fetching all dashboard data...`);
        
        const [financialNewsContent, cryptoNewsContent] = await Promise.all([
            getNewsFromSource("https://www.investing.com/rss/news_25.rss"),
            getNewsFromSource("https://www.investing.com/rss/news_301.rss"),
        ]);
        
        const promises = [
            getNewsAndCalendarAnalysisForPush(ai, financialNewsContent, cryptoNewsContent, runType).catch(e => {
                console.error(`Error in scheduled push for news/calendar:`, e);
                return { error: true, message: e.message, financialNews:[], cryptoNews:[], calendar:[] };
            }),
            getTrumpTracker(ai).catch(e => {
                console.error(`Error in scheduled push for Trump tracker:`, e);
                return { error: true, message: e.message, schedule: [], topPost: { postContent: "", url: "" } };
            }),
            getCryptoTechnicalAnalysis(ai, { name: 'Bitcoin', ticker: 'BTC' }).catch(e => {
                console.error(`Error in scheduled push for BTC analysis:`, e);
                return { error: true, message: e.message, analysisTimestamp: new Date().toISOString() };
            }),
            getCryptoTechnicalAnalysis(ai, { name: 'Ethereum', ticker: 'ETH' }).catch(e => {
                console.error(`Error in scheduled push for ETH analysis:`, e);
                return { error: true, message: e.message, analysisTimestamp: new Date().toISOString() };
            })
        ];

        const [newsAndCalendarData, trumpTrackerData, btcAnalysisData, ethAnalysisData] = await Promise.all(promises);
        
        const allData = { 
            ...(newsAndCalendarData as any),
            trumpTracker: trumpTrackerData as any,
            cryptoAnalysis: {
                btc: btcAnalysisData as any,
                eth: ethAnalysisData as any,
            }
        };

        await sendComprehensiveDiscordMessage(webhookUrl, allData, runType);
        
        console.log(`Successfully sent comprehensive ${runType} summary to Discord.`);
        res.status(200).json({ success: true, message: `Scheduled ${runType} push completed successfully.` });

    } catch (error) {
        console.error(`Error in scheduled ${runType} push:`, error);
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
        
        // Try to send a failure notification to Discord
        try {
            await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: `🚨 **AI Financial Dashboard Cron Job FAILED** 🚨\n**Type:** ${runType}\n**Error:** ${errorMessage}` })
            });
        } catch (discordError) {
            console.error("Failed to send failure notification to Discord:", discordError);
        }

        res.status(500).json({ error: `Internal Server Error: ${errorMessage}` });
    }
}
