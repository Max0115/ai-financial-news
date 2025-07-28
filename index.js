
import React, { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { jsx, jsxs } from "react/jsx-runtime";

// 擴展 RSS 來源列表
const RSS_FEEDS = [
    { name: "Investing.com - 主要新聞", url: "https://www.investing.com/rss/news_25.rss" },
    { name: "Investing.com - 外匯", url: "https://www.investing.com/rss/news_1.rss" },
    { name: "DailyFX - 市場新聞", url: "https://www.dailyfx.com/feeds/market-news" },
    { name: "Reuters - 市場", url: "https://www.reuters.com/pf/api/v3/content/fetch/articles-by-section-id-v1?query=%7B%22section_id%22%3A%22%2Fmarkets%2F%22%2C%22size%22%3A10%2C%22website%22%3A%22reuters%22%7D" }
];

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

  return jsxs("div", {
    className: "app-container",
    children: [
      jsxs("header", {
        className: "header",
        children: [
          jsx("h1", { children: "AI Financial News Assistant" }),
          jsx("p", { children: "由 Gemini 分析的最新財經動態" })
        ]
      }),
      jsxs("div", {
        className: "controls-panel",
        children: [
          jsxs("div", {
            className: "control-group",
            children: [
              jsx("label", { htmlFor: "feed-select", children: "新聞來源:" }),
              jsx("select", {
                id: "feed-select",
                value: selectedFeed,
                onChange: e => setSelectedFeed(e.target.value),
                disabled: loading,
                children: RSS_FEEDS.map(feed => jsx("option", { value: feed.url, children: feed.name }, feed.url))
              })
            ]
          }),
          jsxs("div", {
            className: "control-group",
            children: [
              jsx("button", {
                onClick: () => setRefreshTrigger(prev => prev + 1),
                disabled: loading,
                children: loading ? '刷新中...' : '立即刷新'
              }),
              jsx("button", {
                onClick: handleSendToDiscord,
                disabled: loading || articles.length === 0 || isSendingToDiscord,
                children: isSendingToDiscord ? '發送中...' : '手動推送到 Discord'
              })
            ]
          }),
          jsx("div", {
            className: "auto-push-status",
            children: jsx("p", { children: "ℹ️ 後端自動推送已啟用，每 5 分鐘更新一次。" })
          })
        ]
      }),
      discordStatus && jsx("div", {
        className: `discord-status ${discordStatus.type} show`,
        children: discordStatus.message
      }),
      jsxs("main", {
        children: [
          loading && jsxs("div", {
            className: "loader-container",
            children: [
              jsx("div", { className: "loader" }),
              jsx("p", { children: `正在從 ${RSS_FEEDS.find(f => f.url === selectedFeed)?.name || '來源'} 獲取並分析新聞...` })
            ]
          }),
          error && jsxs("div", {
            className: "error-container",
            children: [
              jsx("h2", { children: "糟糕，出錯了！" }),
              jsx("p", { children: error })
            ]
          }),
          !loading && !error && jsx("div", {
            className: "articles-grid",
            children: articles.length > 0 ? articles.map((article, index) => jsxs("article", {
              className: "article-card",
              children: [
                jsxs("div", {
                  className: "card-header",
                  children: [
                    jsx("h2", {
                      children: jsx("a", {
                        href: article.link,
                        target: "_blank",
                        rel: "noopener noreferrer",
                        children: article.eventName
                      })
                    }),
                    jsx("span", {
                      className: `importance-badge importance-${article.importance}`,
                      children: article.importance
                    })
                  ]
                }),
                jsx("div", {
                  className: "card-body",
                  children: jsx("p", { children: article.summary })
                })
              ]
            }, index)) : jsx("p", { children: "目前沒有可顯示的財經新聞，或 AI 未能從來源中提取有效資訊。" })
          })
        ]
      })
    ]
  });
};

const container = document.getElementById("root");
const root = createRoot(container);
root.render(jsx(App, {}));
