
import React, { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";

// 擴展 RSS 來源列表
const RSS_FEEDS = [
    { name: "Investing.com - 主要新聞", url: "https://www.investing.com/rss/news_25.rss" },
    { name: "Investing.com - 加密貨幣", url: "https://www.investing.com/rss/news_301.rss" },
    { name: "Investing.com - 外匯", url: "https://www.investing.com/rss/news_1.rss" },
    { name: "DailyFX - 市場新聞", url: "https://www.dailyfx.com/feeds/market-news" },
    { name: "Reuters - 市場", url: "https://www.reuters.com/pf/api/v3/content/fetch/articles-by-section-id-v1?query=%7B%22section_id%22%3A%22%2Fmarkets%2F%22%2C%22size%22%3A10%2C%22website%22%3A%22reuters%22%7D" }
];

interface FinancialArticle {
  eventName: string;
  summary: string;
  importance: 'High' | 'Medium' | 'Low';
  link: string;
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
  
  const intervalRef = useRef<number | null>(null);
  
  const fetchAndProcessNews = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDiscordStatus(null);
    
    try {
      const apiUrl = `/api/getNews?feedUrl=${encodeURIComponent(selectedFeed)}`;
      const response = await fetch(apiUrl);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '從後端獲取新聞失敗');
      }

      setArticles(data);

    } catch (err) {
      console.error("處理過程中發生錯誤:", err);
      let errorMessage = "發生未知錯誤，請檢查主控台。";
      if (err instanceof Error) {
        errorMessage = err.message;
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

  // Effect for automatic refresh timer FOR THE VIEW, not for pushing
  useEffect(() => {
    if (intervalRef.current) {
        clearInterval(intervalRef.current);
    }
    // Refresh the view every 5 minutes
    intervalRef.current = window.setInterval(() => {
        setRefreshTrigger(prev => prev + 1); 
    }, 5 * 60 * 1000); 

    return () => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
        }
    };
  }, []);

  const handleSendToDiscord = useCallback(async () => {
    if (articles.length === 0 || isSendingToDiscord) return;
    setIsSendingToDiscord(true);
    setDiscordStatus(null);
    
    const feedName = RSS_FEEDS.find(feed => feed.url === selectedFeed)?.name || "財經新聞";
    let content = `**${feedName} - AI 摘要 (手動發送 - ${new Date().toLocaleString()})**\n\n`;
    articles.forEach(article => {
        content += `> **[${article.eventName}](${article.link})** (${article.importance})\n> ${article.summary}\n\n`;
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
  }, [articles, selectedFeed, isSendingToDiscord]);

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
                {isSendingToDiscord ? '發送中...' : '手動推送到 Discord'}
            </button>
        </div>
         <div className="auto-push-status">
            <p>ℹ️ 每日自動推送已啟用 (台灣時間晚上 8:30)。</p>
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
                  <h2>
                    <a href={article.link} target="_blank" rel="noopener noreferrer">
                      {article.eventName}
                    </a>
                  </h2>
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