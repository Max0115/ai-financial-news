/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI, Type } from "@google/genai";

// 擴展 RSS 來源列表
const RSS_FEEDS = [
    { name: "Investing.com - 主要新聞", url: "https://www.investing.com/rss/news_25.rss" },
    { name: "Investing.com - 外匯", url: "https://www.investing.com/rss/news_1.rss" },
    { name: "DailyFX - 市場新聞", url: "https://www.dailyfx.com/feeds/market-news" },
    { name: "Reuters - 市場", url: "https://www.reuters.com/pf/api/v3/content/fetch/articles-by-section-id-v1?query=%7B%22section_id%22%3A%22%2Fmarkets%2F%22%2C%22size%22%3A10%2C%22website%22%3A%22reuters%22%7D&_website=reuters" } // Note: Reuters is JSON, not XML
];

interface FinancialArticle {
  eventName: string;
  summary: string;
  importance: 'High' | 'Medium' | 'Low';
}

interface DiscordStatus {
    message: string;
    type: 'success' | 'error';
}

const App: React.FC = () => {
  const [articles, setArticles] = useState<FinancialArticle[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFeed, setSelectedFeed] = useState<string>(RSS_FEEDS[0].url);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [discordStatus, setDiscordStatus] = useState<DiscordStatus | null>(null);
  const [isSendingToDiscord, setIsSendingToDiscord] = useState<boolean>(false);
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  
  const fetchAndProcessNews = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDiscordStatus(null);
    const PROXY_URL = `https://api.allorigins.win/raw?url=${encodeURIComponent(selectedFeed)}`;

    try {
      const response = await fetch(PROXY_URL);
      if (!response.ok) {
        throw new Error(`無法獲取 RSS feed。狀態碼: ${response.status}`);
      }
      const rawText = await response.text();
      
      let newsContent: string;
      // Handle different feed formats
      if (selectedFeed.includes("reuters.com")) {
        const json = JSON.parse(rawText);
        newsContent = json.result.articles.slice(0, 8).map((item: any) => 
            `標題: ${item.title}\n描述: ${item.description}`
        ).join("\n\n---\n\n");
      } else { // XML-based feeds
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(rawText, "application/xml");
        const items = Array.from(xmlDoc.querySelectorAll("item")).slice(0, 8);
        if (items.length === 0) {
            setArticles([]);
            setLoading(false);
            return;
        }
        newsContent = items.map(item => {
            const title = item.querySelector("title")?.textContent || "";
            const description = item.querySelector("description")?.textContent || "";
            return `標題: ${title}\n描述: ${description}`;
        }).join("\n\n---\n\n");
      }

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
      const result = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `你是專業的金融分析師。請從以下新聞項目中，為每個項目提取關鍵資訊。提供事件名稱、簡要摘要，並評估其重要性（高、中、低）。忽略無關緊要的市場評論。根據提供的 schema 將輸出格式化為 JSON 陣列。\n\n${newsContent}`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                eventName: { type: Type.STRING, description: '金融事件或數據發布的名稱。'},
                summary: { type: Type.STRING, description: '對新聞的一句話簡要總結。'},
                importance: { type: Type.STRING, description: '評估的重要性: High, Medium, or Low.'},
              },
              required: ["eventName", "summary", "importance"],
            },
          },
        },
      });
      
      const processedText = result.text.trim();
      const processedArticles: FinancialArticle[] = JSON.parse(processedText);
      setArticles(processedArticles);

    } catch (err) {
      console.error("處理過程中發生錯誤:", err);
      let errorMessage = "發生未知錯誤，請檢查主控台。";
      if (err instanceof Error) {
        errorMessage = err.message.includes("fetch") 
          ? "無法從 RSS feed 獲取資料。代理服務可能暫時無法使用，請稍後再試。" 
          : err.message;
      }
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [selectedFeed]);

  // Effect for fetching data on feed change or manual refresh
  useEffect(() => {
    fetchAndProcessNews();
  }, [fetchAndProcessNews, refreshTrigger]);

  // Effect for automatic refresh timer
  useEffect(() => {
    if (intervalRef.current) {
        clearInterval(intervalRef.current);
    }
    intervalRef.current = setInterval(() => {
        setRefreshTrigger(prev => prev + 1); // Trigger refresh
    }, 5 * 60 * 1000); // 5 minutes

    return () => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
        }
    };
  }, []);

  const handleSendToDiscord = async () => {
    if (articles.length === 0) return;
    setIsSendingToDiscord(true);
    setDiscordStatus(null);
    
    const feedName = RSS_FEEDS.find(feed => feed.url === selectedFeed)?.name || "財經新聞";
    let content = `**${feedName} - AI 摘要 (${new Date().toLocaleString()})**\n\n`;
    articles.forEach(article => {
        content += `> **${article.eventName}** (${article.importance})\n> ${article.summary}\n\n`;
    });

    try {
        const response = await fetch('/api/sendToDiscord', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: content }),
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || '發送到 Discord 失敗');
        }
        setDiscordStatus({ message: '成功發送到 Discord！', type: 'success' });
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : '未知錯誤';
        setDiscordStatus({ message: `發送失敗: ${errorMessage}`, type: 'error' });
        console.error(err);
    } finally {
        setIsSendingToDiscord(false);
        setTimeout(() => setDiscordStatus(null), 5000); // Hide status after 5s
    }
  };

  return (
    <div className="app-container">
      <header className="header">
        <h1>AI Financial News Assistant</h1>
        <p>由 Gemini 分析的最新財經動態</p>
      </header>

      <div className="controls-panel">
        <div className="control-group">
            <label htmlFor="feed-select">新聞來源:</label>
            <select id="feed-select" value={selectedFeed} onChange={e => setSelectedFeed(e.target.value)} disabled={loading}>
                {RSS_FEEDS.map(feed => (
                    <option key={feed.url} value={feed.url}>{feed.name}</option>
                ))}
            </select>
        </div>
        <div className="control-group">
            <button onClick={() => setRefreshTrigger(prev => prev + 1)} disabled={loading}>
                {loading ? '刷新中...' : '立即刷新'}
            </button>
            <button onClick={handleSendToDiscord} disabled={loading || articles.length === 0 || isSendingToDiscord}>
                {isSendingToDiscord ? '發送中...' : '推送到 Discord'}
            </button>
        </div>
      </div>
        
      {discordStatus && (
        <div className={`discord-status ${discordStatus.type} show`}>
            {discordStatus.message}
        </div>
      )}

      <main>
        {loading && (
          <div className="loader-container">
            <div className="loader"></div>
            <p>正在從 {RSS_FEEDS.find(f => f.url === selectedFeed)?.name || '來源'} 獲取並分析新聞...</p>
          </div>
        )}
        {error && (
            <div className="error-container">
                <h2>糟糕，出錯了！</h2>
                <p>{error}</p>
            </div>
        )}
        {!loading && !error && (
          <div className="articles-grid">
            {articles.length > 0 ? articles.map((article, index) => (
              <article key={index} className="article-card">
                <div className="card-header">
                  <h2>{article.eventName}</h2>
                  <span className={`importance-badge importance-${article.importance}`}>{article.importance}</span>
                </div>
                <div className="card-body">
                  <p>{article.summary}</p>
                </div>
              </article>
            )) : <p>目前沒有可顯示的財經新聞，或 AI 未能從來源中提取有效資訊。</p>}
          </div>
        )}
      </main>
    </div>
  );
};

const container = document.getElementById("root");
const root = createRoot(container!);
root.render(<App />);