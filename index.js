import React, { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";

// 擴展 RSS 來源列表
const RSS_FEEDS = [
    { name: "Investing.com - 主要新聞", url: "https://www.investing.com/rss/news_25.rss" },
    { name: "Investing.com - 外匯", url: "https://www.investing.com/rss/news_1.rss" },
    { name: "DailyFX - 市場新聞", url: "https://www.dailyfx.com/feeds/market-news" },
    { name: "Reuters - 市場", url: "https://www.reuters.com/pf/api/v3/content/fetch/articles-by-section-id-v1?query=%7B%22section_id%22%3A%22%2Fmarkets%2F%22%2C%22size%22%3A10%2C%22website%22%3A%22reuters%22%7D" }
];

// Helper function to format dates as "time ago"
function formatTimeAgo(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    let interval = seconds / 31536000;
    if (interval > 1) return `${Math.floor(interval)} 年前`;
    interval = seconds / 2592000;
    if (interval > 1) return `${Math.floor(interval)} 個月前`;
    interval = seconds / 86400;
    if (interval > 1) return `${Math.floor(interval)} 天前`;
    interval = seconds / 3600;
    if (interval > 1) return `${Math.floor(interval)} 小時前`;
    interval = seconds / 60;
    if (interval > 1) return `${Math.floor(interval)} 分鐘前`;
    return `${Math.floor(seconds)} 秒前`;
}


const App = () => {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedFeed, setSelectedFeed] = useState(RSS_FEEDS[0].url);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [discordStatus, setDiscordStatus] = useState(null);
  const [isSendingToDiscord, setIsSendingToDiscord] = useState(false);
  
  const intervalRef = useRef(null);
  
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

  // Effect for automatic refresh timer
  useEffect(() => {
    if (intervalRef.current) {
        clearInterval(intervalRef.current);
    }
    intervalRef.current = window.setInterval(() => {
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
        const timeAgo = formatTimeAgo(article.publicationDate);
        content += `> **[${article.eventName}](${article.link})** (${article.importance}) - *${timeAgo}*\n> ${article.summary}\n\n`;
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
    React.createElement("div", { className: "app-container" },
      React.createElement("header", { className: "header" },
        React.createElement("h1", null, "AI Financial News Assistant"),
        React.createElement("p", null, "由 Gemini 分析的最新財經動態")
      ),

      React.createElement("div", { className: "controls-panel" },
        React.createElement("div", { className: "control-group" },
            React.createElement("label", { htmlFor: "feed-select" }, "新聞來源:"),
            React.createElement("select", { id: "feed-select", value: selectedFeed, onChange: e => setSelectedFeed(e.target.value), disabled: loading },
                RSS_FEEDS.map(feed => (
                    React.createElement("option", { key: feed.url, value: feed.url }, feed.name)
                ))
            )
        ),
        React.createElement("div", { className: "control-group" },
            React.createElement("button", { onClick: () => setRefreshTrigger(prev => prev + 1), disabled: loading },
                loading ? '刷新中...' : '立即刷新'
            ),
            React.createElement("button", { onClick: handleSendToDiscord, disabled: loading || articles.length === 0 || isSendingToDiscord },
                isSendingToDiscord ? '發送中...' : '推送到 Discord'
            )
        )
      ),
        
      discordStatus && (
        React.createElement("div", { className: `discord-status ${discordStatus.type} show` },
            discordStatus.message
        )
      ),

      React.createElement("main", null,
        loading && (
          React.createElement("div", { className: "loader-container" },
            React.createElement("div", { className: "loader" }),
            React.createElement("p", null, `正在從 ${RSS_FEEDS.find(f => f.url === selectedFeed)?.name || '來源'} 獲取並分析新聞...`)
          )
        ),
        error && (
            React.createElement("div", { className: "error-container" },
                React.createElement("h2", null, "糟糕，出錯了！"),
                React.createElement("p", null, error)
            )
        ),
        !loading && !error && (
          React.createElement("div", { className: "articles-grid" },
            articles.length > 0 ? articles.map((article, index) => (
              React.createElement("article", { key: index, className: "article-card" },
                React.createElement("div", { className: "card-header" },
                  React.createElement("h2", null,
                    React.createElement("a", { href: article.link, target: "_blank", rel: "noopener noreferrer" },
                      article.eventName
                    )
                  ),
                  React.createElement("span", { className: `importance-badge importance-${article.importance}` }, article.importance)
                ),
                React.createElement("div", { className: "card-body" },
                  React.createElement("p", null, article.summary)
                ),
                React.createElement("div", { className: "card-footer" },
                  React.createElement("span", { className: "publication-date" }, formatTimeAgo(article.publicationDate))
                )
              )
            )) : React.createElement("p", null, "目前沒有可顯示的財經新聞，或 AI 未能從來源中提取有效資訊。")
          )
        )
      )
    )
  );
};

const container = document.getElementById("root");
const root = createRoot(container);
root.render(React.createElement(App));
