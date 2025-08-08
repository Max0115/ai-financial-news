import React, { useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { jsx, jsxs } from "react/jsx-runtime";

const App = () => {
  const [dashboardData, setDashboardData] = useState({});
  const [loading, setLoading] = useState({ news: true, calendar: true, trump: true, crypto: true });
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('news');
  const [discordStatus, setDiscordStatus] = useState(null);
  const [isSendingToDiscord, setIsSendingToDiscord] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const fetchDashboardData = useCallback(async () => {
    setLoading({ news: true, calendar: true, trump: true, crypto: true });
    setError(null);
    setDiscordStatus(null);
    
    try {
      const response = await fetch('/api/getDashboardData');
      if (!response.ok) {
        let errorMessage = '從後端獲取儀表板數據失敗';
        try {
            const errorData = await response.json();
            errorMessage = `Internal Server Error: ${errorData.error || response.statusText}`;
        } catch (e) {
             errorMessage = `Internal Server Error: got status: ${response.status}`;
        }
        throw new Error(errorMessage);
      }
      const data = await response.json();
      setDashboardData(data);
    } catch (err) {
      console.error("處理過程中發生錯誤:", err);
      let errorMessage = "發生未知錯誤，請檢查主控台。";
      if (err instanceof Error) {
        errorMessage = err.message;
      }
      if (typeof errorMessage === 'string' && (errorMessage.includes('429') || errorMessage.toUpperCase().includes('RESOURCE_EXHAUSTED') || errorMessage.includes('quota'))) {
        errorMessage = 'API 請求過於頻繁，已超出用量額度。請稍候一分鐘再重試。';
      }
      setError(errorMessage);
    } finally {
      setLoading({ news: false, calendar: false, trump: false, crypto: false });
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData, refreshTrigger]);

  const getCountryFlag = (countryCode) => {
    const flags = {
        'US': '🇺🇸', 'CN': '🇨🇳', 'JP': '🇯🇵', 'DE': '🇩🇪', 'GB': '🇬🇧', 'EU': '🇪🇺', 'FR': '🇫🇷', 'IT': '🇮🇹', 'CA': '🇨🇦', 'AU': '🇦🇺', 'NZ': '🇳🇿', 'CH': '🇨🇭'
    };
    return flags[countryCode.toUpperCase()] || '🏳️';
  };
  
  const getImportanceEmoji = (importance) => {
      switch(importance) {
          case 'High': return '🔥';
          case 'Medium': return '⚠️';
          case 'Low': return '✅';
          default: return '';
      }
  };

  const handleSendToDiscord = useCallback(async () => {
    if (isSendingToDiscord) return;
    setIsSendingToDiscord(true);
    setDiscordStatus(null);
    
    const { financialNews, cryptoNews, calendar, trumpTracker, cryptoAnalysis } = dashboardData;
    const embeds = [];

    const timestamp = new Date().toISOString();
    
    if (financialNews && financialNews.length > 0) {
        embeds.push({
            title: '📰 主要財經新聞',
            color: 3447003, // Blue
            description: financialNews.map(a => `> **[${a.eventName}](${a.link})** (${a.importance})\n> ${a.summary}`).join('\n\n'),
        });
    }

    if (cryptoNews && cryptoNews.length > 0) {
        embeds.push({
            title: '📈 加密貨幣新聞',
            color: 15844367, // Gold
            description: cryptoNews.map(a => `> **[${a.eventName}](${a.link})** (${a.importance})\n> ${a.summary}`).join('\n\n'),
        });
    }

    if (calendar && calendar.length > 0) {
        embeds.push({
            title: '🗓️ 本週財經日曆',
            color: 5763719, // Green
            description: calendar.slice(0, 10).map(e => `> **${e.date.substring(5)} ${e.time}** ${getCountryFlag(e.country)} ${e.eventName} (${getImportanceEmoji(e.importance)} ${e.importance})`).join('\n'),
        });
    }

    if (trumpTracker) {
        const fields = [];
        if (trumpTracker.schedule && trumpTracker.schedule.length > 0) {
            fields.push({
                name: '🎤 行程與演講',
                value: trumpTracker.schedule.map(item => `> - **${item.date.substring(5)} ${item.time}:** ${item.eventDescription}`).join('\n'),
                inline: false,
            });
        }
        if (trumpTracker.topPost && trumpTracker.topPost.postContent) {
            fields.push({
                name: '💬 Truth Social 熱門',
                value: `> [原文連結](${trumpTracker.topPost.url})\n> "${trumpTracker.topPost.postContent}"`,
                inline: false,
            });
        }
        if (fields.length > 0) {
            embeds.push({
                title: '🦅 川普動態',
                color: 15105570, // Red
                fields: fields,
            });
        }
    }
    
    const createCryptoEmbed = (analysisData, name) => {
        if (!analysisData || analysisData.error) return null;
        const { marketStructure, keyLevels, bullishScenario, bearishScenario, dataSource, currentBias, analysisTimestamp } = analysisData;
        const fields = [];
        if (currentBias) {
            const sentimentEmoji = currentBias.sentiment === 'Bullish' ? '📈' : '📉';
            fields.push({ name: `當前趨勢: ${currentBias.sentiment} ${sentimentEmoji}`, value: `> 目標區間: ${currentBias.targetRange}`, inline: false });
        }
        if (marketStructure) fields.push({ name: '市場結構', value: `> ${marketStructure}`, inline: false });
        if (keyLevels) {
            let keyLevelsValue = '';
            if (keyLevels.liquidityPools?.length) keyLevelsValue += `> **流動性池:** ${keyLevels.liquidityPools.join(', ')}\n`;
            if (keyLevels.orderBlocks?.length) keyLevelsValue += `> **訂單塊:** ${keyLevels.orderBlocks.join(', ')}\n`;
            if (keyLevels.fairValueGaps?.length) keyLevelsValue += `> **FVG:** ${keyLevels.fairValueGaps.join(', ')}\n`;
            if (keyLevelsValue) fields.push({ name: '關鍵價位', value: keyLevelsValue, inline: false });
        }
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

    if (cryptoAnalysis) {
        const ethEmbed = createCryptoEmbed(cryptoAnalysis.eth, 'ETH');
        if (ethEmbed) embeds.push(ethEmbed);

        const btcEmbed = createCryptoEmbed(cryptoAnalysis.btc, 'BTC');
        if (btcEmbed) embeds.push(btcEmbed);
    }

    if (embeds.length > 0) {
        embeds[embeds.length-1].footer = { text: 'AI Financial Insight Dashboard' };
        embeds[embeds.length-1].timestamp = timestamp;
    }

    try {
        const response = await fetch('/api/sendToDiscord', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ embeds }),
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
        setTimeout(() => setDiscordStatus(null), 5000);
    }
  }, [dashboardData, isSendingToDiscord]);
  
  const renderNews = (title, articles, isLoading) => jsxs("div", {
    className: "news-section",
    children: [
      jsx("h3", { children: title }),
      isLoading && jsx("div", { className: "loader small" }),
      !isLoading && articles && articles.length > 0 ? jsx("div", {
        className: "articles-grid",
        children: articles.map((article, index) => jsxs("article", {
          className: "article-card",
          children: [
            jsxs("div", {
              className: "card-header",
              children: [
                jsx("h2", { children: jsx("a", { href: article.link, target: "_blank", rel: "noopener noreferrer", children: article.eventName }) }),
                jsx("span", { className: `importance-badge importance-${article.importance}`, children: article.importance })
              ]
            }),
            jsx("div", { className: "card-body", children: jsx("p", { children: article.summary }) })
          ]
        }, index))
      }) : !isLoading && jsx("p", { children: "目前沒有可顯示的新聞。" })
    ]
  });

  const renderCalendar = (events, isLoading) => jsx("div", {
    className: "calendar-section",
    children: [
      isLoading && jsx("div", { className: "loader small" }),
      !isLoading && events && events.length > 0 ? jsx("ul", {
        className: "calendar-list",
        children: events.map((event, index) => jsxs("li", {
          className: "calendar-item",
          children: [
            jsxs("div", {
              className: "calendar-time",
              children: [
                jsx("span", { className: "date", children: event.date }),
                jsx("span", { className: "time", children: event.time })
              ]
            }),
            jsxs("div", {
              className: "calendar-details",
              children: [
                jsx("span", { className: "country-flag", children: getCountryFlag(event.country) }),
                jsx("span", { className: "event-name", children: event.eventName })
              ]
            }),
            jsxs("div", {
              className: `calendar-importance importance-${event.importance}`,
              children: [getImportanceEmoji(event.importance), " ", event.importance]
            })
          ]
        }, index))
      }) : !isLoading && jsx("p", { children: "未能獲取未來一週的財經日曆。" })
    ]
  });

  const renderTrumpTracker = (data, isLoading) => jsx("div", {
    className: "trump-tracker-section",
    children: [
      isLoading && jsx("div", { className: "loader small" }),
      !isLoading && data ? jsxs("div", {
        className: "info-grid",
        children: [
          jsxs("div", {
            className: "info-card",
            children: [
              jsx("h4", { children: "🎤 行程與演講 (今明兩天)" }),
              data.schedule && data.schedule.length > 0 ? jsx("ul", {
                children: data.schedule.map((item, index) => jsxs("li", {
                  children: [
                    jsx("strong", { children: `${item.date.substring(5)} ${item.time}:` }),
                    " ",
                    item.eventDescription
                  ]
                }, index))
              }) : jsx("p", { children: "目前沒有已知的公開行程。" })
            ]
          }),
          jsxs("div", {
            className: "info-card",
            children: [
              jsx("h4", { children: "💬 Truth Social 當日熱門" }),
              data.topPost && data.topPost.postContent ? jsxs("p", {
                children: [
                  `"${data.topPost.postContent}"`,
                  jsx("a", { href: data.topPost.url, target: "_blank", rel: "noopener noreferrer", className: "source-link", children: " (來源)" })
                ]
              }) : jsx("p", { children: "未能獲取今日熱門貼文。" })
            ]
          })
        ]
      }) : !isLoading && jsx("p", { children: "未能獲取川普的相關動態。" })
    ]
  });

  const formatWithBold = (text) => {
    if (!text) return 'N/A';
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return jsx("strong", { children: part.slice(2, -2) }, i);
      }
      return part;
    });
  };
  
  const renderSingleCoinAnalysis = (data, name) => {
    const coinTicker = name.toUpperCase();
    if (!data || data.error) {
      return jsxs("div", {
        className: "analysis-card",
        children: [
          jsx("h4", { children: `${coinTicker} 技術分析` }),
          data?.analysisTimestamp && jsx("p", { className: "analysis-timestamp", children: `分析時間: ${new Date(data.analysisTimestamp).toLocaleString('zh-TW')}` }),
          jsx("div", {
            className: "error-container",
            style: { padding: '1rem 0' },
            children: jsx("p", { children: data?.message || `未能獲取 ${coinTicker} 分析數據。` })
          })
        ]
      });
    }
    const { dataSource, marketStructure, keyLevels, bullishScenario, bearishScenario, currentBias, analysisTimestamp } = data;
    const biasClass = currentBias?.sentiment === 'Bullish' ? 'bias-bullish' : 'bias-bearish';

    return jsxs("div", {
      className: "analysis-card",
      children: [
        jsx("h4", { children: `${coinTicker} 技術分析` }),
        jsx("p", { className: "analysis-timestamp", children: `分析時間: ${new Date(analysisTimestamp).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}` }),
        jsx("p", { className: "data-source", children: `數據來源: ${dataSource || 'AI 綜合分析'}` }),
        currentBias && jsxs("div", {
          className: `sub-card current-bias ${biasClass}`,
          children: [
            jsx("h5", { children: `當前趨勢: ${currentBias.sentiment === 'Bullish' ? '看漲 📈' : '看跌 📉'}` }),
            jsx("p", { children: ["目標區間: ", formatWithBold(currentBias.targetRange)] })
          ]
        }),
        jsxs("div", {
          className: "sub-card",
          children: [
            jsx("h5", { children: "市場結構分析" }),
            jsx("p", { children: formatWithBold(marketStructure) })
          ]
        }),
        jsxs("div", {
          className: "sub-card",
          children: [
            jsx("h5", { children: "關鍵價位" }),
            keyLevels && (keyLevels.liquidityPools?.length || keyLevels.orderBlocks?.length || keyLevels.fairValueGaps?.length) ? jsx("ul", {
              children: [
                keyLevels.liquidityPools?.length > 0 && jsxs("li", { children: [jsx("strong", { children: "流動性池:" }), " ", formatWithBold(keyLevels.liquidityPools.join(', '))] }),
                keyLevels.orderBlocks?.length > 0 && jsxs("li", { children: [jsx("strong", { children: "訂單塊:" }), " ", formatWithBold(keyLevels.orderBlocks.join(', '))] }),
                keyLevels.fairValueGaps?.length > 0 && jsxs("li", { children: [jsx("strong", { children: "FVG:" }), " ", formatWithBold(keyLevels.fairValueGaps.join(', '))] })
              ]
            }) : jsx("p", { children: "未能識別關鍵價位。" })
          ]
        }),
        jsxs("div", {
          className: "scenario-grid",
          children: [
            jsxs("div", {
              className: "sub-card scenario-bullish",
              children: [
                jsx("h5", { children: "看漲劇本 🐂" }),
                jsx("p", { children: formatWithBold(bullishScenario) })
              ]
            }),
            jsxs("div", {
              className: "sub-card scenario-bearish",
              children: [
                jsx("h5", { children: "看跌劇本 🐻" }),
                jsx("p", { children: formatWithBold(bearishScenario) })
              ]
            })
          ]
        })
      ]
    });
  }

  const renderCryptoAnalysis = (data, isLoading) => {
    if (isLoading) return jsx("div", { className: "loader" });
    if (!data) {
      return jsx("div", { className: "error-container", style: { padding: '2rem' }, children: jsx("p", { children: "未能獲取加密貨幣分析數據。" }) });
    }

    return jsxs("div", {
      className: "crypto-analysis-container",
      children: [
        renderSingleCoinAnalysis(data.btc, 'BTC'),
        renderSingleCoinAnalysis(data.eth, 'ETH')
      ]
    });
  };


  return jsxs("div", {
    className: "app-container",
    children: [
      jsxs("header", {
        className: "header",
        children: [
          jsx("h1", { children: "AI Financial Insight Dashboard" }),
          jsx("p", { children: "由 Gemini 分析的最新財經動態、日曆與時事" })
        ]
      }),
      jsxs("div", {
        className: "controls-panel",
        children: [
          jsxs("div", {
            className: "control-group",
            children: [
              jsx("button", {
                onClick: () => setRefreshTrigger(prev => prev + 1),
                disabled: Object.values(loading).some(v => v),
                children: Object.values(loading).some(v => v) ? '刷新中...' : '立即刷新'
              }),
              jsx("button", {
                onClick: handleSendToDiscord,
                disabled: isSendingToDiscord || Object.values(loading).some(v => v),
                children: isSendingToDiscord ? '發送中...' : '手動推送到 Discord'
              })
            ]
          }),
          jsx("div", {
            className: "auto-push-status",
            children: jsx("p", { children: "ℹ️ 自動摘要將於台灣時間 每日早上 6:50 及 晚上 7:30 推送到 Discord。" })
          })
        ]
      }),
      discordStatus && jsx("div", {
        className: `discord-status ${discordStatus.type} show`,
        children: discordStatus.message
      }),
      jsxs("main", {
        children: [
          jsxs("div", {
            className: "tabs",
            children: [
              jsx("button", { className: `tab-button ${activeTab === 'news' ? 'active' : ''}`, onClick: () => setActiveTab('news'), children: "📰 新聞摘要" }),
              jsx("button", { className: `tab-button ${activeTab === 'calendar' ? 'active' : ''}`, onClick: () => setActiveTab('calendar'), children: "🗓️ 財經日曆" }),
              jsx("button", { className: `tab-button ${activeTab === 'trump' ? 'active' : ''}`, onClick: () => setActiveTab('trump'), children: "🦅 川普動態" }),
              jsx("button", { className: `tab-button ${activeTab === 'crypto' ? 'active' : ''}`, onClick: () => setActiveTab('crypto'), children: "📈 加密貨幣分析" })
            ]
          }),
          jsx("div", {
            className: "tab-content",
            children: error ? jsxs("div", {
              className: "error-container",
              children: [
                jsx("h2", { children: "糟糕，出錯了！" }),
                jsx("p", { children: error }),
                jsx("button", { onClick: () => setRefreshTrigger(prev => prev + 1), style: { marginTop: '1rem' }, children: "重試" })
              ]
            }) : jsxs(React.Fragment, {
              children: [
                activeTab === 'news' && jsx("div", {
                  className: "news-container",
                  children: [
                    renderNews("主要財經新聞", dashboardData.financialNews, loading.news),
                    renderNews("加密貨幣新聞", dashboardData.cryptoNews, loading.news)
                  ]
                }),
                activeTab === 'calendar' && renderCalendar(dashboardData.calendar, loading.calendar),
                activeTab === 'trump' && renderTrumpTracker(dashboardData.trumpTracker, loading.trump),
                activeTab === 'crypto' && renderCryptoAnalysis(dashboardData.cryptoAnalysis, loading.crypto)
              ]
            })
          })
        ]
      })
    ]
  });
};

const container = document.getElementById("root");
const root = createRoot(container);
root.render(jsx(App, {}));