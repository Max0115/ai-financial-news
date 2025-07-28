
import React, { useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";

interface FinancialArticle {
  eventName: string;
  summary: string;
  importance: 'High' | 'Medium' | 'Low';
  link: string;
}

interface CalendarEvent {
    date: string;
    time: string;
    country: string;
    eventName: string;
    importance: 'High' | 'Medium' | 'Low';
}

interface TrumpSchedule {
    date: string;
    time: string;
    eventDescription: string;
}

interface TrumpPost {
    postContent: string;
    url: string;
}

interface TrumpTrackerData {
    schedule: TrumpSchedule[];
    topPost: TrumpPost;
}

interface DashboardData {
    financialNews: FinancialArticle[];
    cryptoNews: FinancialArticle[];
    calendar: CalendarEvent[];
    trumpTracker: TrumpTrackerData;
}

interface DiscordStatus {
    message: string;
    type: 'success' | 'error';
}

type LoadingState = {
    news: boolean;
    calendar: boolean;
    trump: boolean;
};

const App: React.FC = () => {
  const [dashboardData, setDashboardData] = useState<Partial<DashboardData>>({});
  const [loading, setLoading] = useState<LoadingState>({ news: true, calendar: true, trump: true });
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'news' | 'calendar' | 'trump'>('news');
  const [discordStatus, setDiscordStatus] = useState<DiscordStatus | null>(null);
  const [isSendingToDiscord, setIsSendingToDiscord] = useState<boolean>(false);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);

  const fetchDashboardData = useCallback(async () => {
    setLoading({ news: true, calendar: true, trump: true });
    setError(null);
    setDiscordStatus(null);
    
    try {
      const response = await fetch('/api/getDashboardData');
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '從後端獲取儀表板數據失敗');
      }
      const data: DashboardData = await response.json();
      setDashboardData(data);
    } catch (err) {
      console.error("處理過程中發生錯誤:", err);
      let errorMessage = "發生未知錯誤，請檢查主控台。";
      if (err instanceof Error) {
        errorMessage = err.message;
      }
      setError(errorMessage);
    } finally {
      setLoading({ news: false, calendar: false, trump: false });
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData, refreshTrigger]);

  const getCountryFlag = (countryCode: string) => {
    const flags: { [key: string]: string } = {
        'US': '🇺🇸', 'CN': '🇨🇳', 'JP': '🇯🇵', 'DE': '🇩🇪', 'GB': '🇬🇧', 'EU': '🇪🇺', 'FR': '🇫🇷', 'IT': '🇮🇹', 'CA': '🇨🇦', 'AU': '🇦🇺', 'NZ': '🇳🇿', 'CH': '🇨🇭'
    };
    return flags[countryCode.toUpperCase()] || '🏳️';
  };
  
  const getImportanceEmoji = (importance: string) => {
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
    
    const { financialNews, cryptoNews, calendar, trumpTracker } = dashboardData;
    let content = `**AI 每日財經洞察 (${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })})**\n\n`;

    if (financialNews && financialNews.length > 0) {
        content += `--- 📰 **主要財經新聞** ---\n\n`;
        financialNews.forEach(article => {
            content += `> **[${article.eventName}](${article.link})** (${article.importance})\n> ${article.summary}\n\n`;
        });
    }
    
    if (cryptoNews && cryptoNews.length > 0) {
        content += `--- 📈 **加密貨幣新聞** ---\n\n`;
        cryptoNews.forEach(article => {
            content += `> **[${article.eventName}](${article.link})** (${article.importance})\n> ${article.summary}\n\n`;
        });
    }

    if (calendar && calendar.length > 0) {
        content += `--- 🗓️ **本週財經日曆** ---\n\n`;
        calendar.slice(0, 7).forEach(event => { // Limit to 7 events for brevity
             content += `> **${event.date.substring(5)} ${event.time}** ${getCountryFlag(event.country)} ${event.eventName} (${getImportanceEmoji(event.importance)} ${event.importance})\n`;
        });
        content += `\n`;
    }

    if (trumpTracker) {
        content += `--- 🦅 **川普動態** ---\n\n`;
        if (trumpTracker.schedule && trumpTracker.schedule.length > 0) {
            content += `> **🎤 行程與演講:**\n`;
            trumpTracker.schedule.forEach(item => {
                content += `> - **${item.date.substring(5)} ${item.time}:** ${item.eventDescription}\n`;
            });
        }
        if (trumpTracker.topPost && trumpTracker.topPost.postContent) {
             content += `> **💬 [Truth Social 熱門](${trumpTracker.topPost.url}):**\n> "${trumpTracker.topPost.postContent}"\n`;
        }
    }


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
        setTimeout(() => setDiscordStatus(null), 5000);
    }
  }, [dashboardData, isSendingToDiscord]);
  
  const renderNews = (title: string, articles: FinancialArticle[] | undefined, isLoading: boolean) => (
    <div className="news-section">
      <h3>{title}</h3>
      {isLoading && <div className="loader small"></div>}
      {!isLoading && articles && articles.length > 0 ? (
         <div className="articles-grid">
            {articles.map((article, index) => (
              <article key={index} className="article-card">
                <div className="card-header">
                  <h2><a href={article.link} target="_blank" rel="noopener noreferrer">{article.eventName}</a></h2>
                  <span className={`importance-badge importance-${article.importance}`}>{article.importance}</span>
                </div>
                <div className="card-body"><p>{article.summary}</p></div>
              </article>
            ))}
        </div>
      ) : !isLoading && <p>目前沒有可顯示的新聞。</p>}
    </div>
  );

  const renderCalendar = (events: CalendarEvent[] | undefined, isLoading: boolean) => (
      <div className="calendar-section">
        {isLoading && <div className="loader small"></div>}
        {!isLoading && events && events.length > 0 ? (
            <ul className="calendar-list">
                {events.map((event, index) => (
                    <li key={index} className="calendar-item">
                        <div className="calendar-time">
                            <span className="date">{event.date}</span>
                            <span className="time">{event.time}</span>
                        </div>
                        <div className="calendar-details">
                            <span className="country-flag">{getCountryFlag(event.country)}</span>
                            <span className="event-name">{event.eventName}</span>
                        </div>
                        <div className={`calendar-importance importance-${event.importance}`}>
                           {getImportanceEmoji(event.importance)} {event.importance}
                        </div>
                    </li>
                ))}
            </ul>
        ) : !isLoading && <p>未能獲取未來一週的財經日曆。</p>}
    </div>
  );

  const renderTrumpTracker = (data: TrumpTrackerData | undefined, isLoading: boolean) => (
      <div className="trump-tracker-section">
        {isLoading && <div className="loader small"></div>}
        {!isLoading && data ? (
            <div className="trump-grid">
                <div className="trump-card">
                    <h4>🎤 行程與演講 (今明兩天)</h4>
                    {data.schedule && data.schedule.length > 0 ? (
                        <ul>
                            {data.schedule.map((item, index) => (
                                <li key={index}><strong>{item.date.substring(5)} {item.time}:</strong> {item.eventDescription}</li>
                            ))}
                        </ul>
                    ) : <p>目前沒有已知的公開行程。</p>}
                </div>
                <div className="trump-card">
                    <h4>💬 Truth Social 當日熱門</h4>
                    {data.topPost && data.topPost.postContent ? (
                        <p>
                            "{data.topPost.postContent}" 
                            <a href={data.topPost.url} target="_blank" rel="noopener noreferrer" className="source-link"> (來源)</a>
                        </p>
                    ) : <p>未能獲取今日熱門貼文。</p>}
                </div>
            </div>
        ) : !isLoading && <p>未能獲取川普的相關動態。</p>}
    </div>
  );


  return (
    <div className="app-container">
      <header className="header">
        <h1>AI Financial Insight Dashboard</h1>
        <p>由 Gemini 分析的最新財經動態、日曆與時事</p>
      </header>

      <div className="controls-panel">
        <div className="control-group">
            <button onClick={() => setRefreshTrigger(prev => prev + 1)} disabled={Object.values(loading).some(v => v)}>
                {Object.values(loading).some(v => v) ? '刷新中...' : '立即刷新'}
            </button>
            <button onClick={handleSendToDiscord} disabled={isSendingToDiscord || Object.values(loading).some(v => v)}>
                {isSendingToDiscord ? '發送中...' : '手動推送到 Discord'}
            </button>
        </div>
         <div className="auto-push-status">
            <p>ℹ️ 每日自動摘要將於台灣時間晚上 8:30 推送到 Discord。</p>
        </div>
      </div>
        
      {discordStatus && (
        <div className={`discord-status ${discordStatus.type} show`}>
            {discordStatus.message}
        </div>
      )}

      <main>
        <div className="tabs">
            <button className={`tab-button ${activeTab === 'news' ? 'active' : ''}`} onClick={() => setActiveTab('news')}>📰 新聞摘要</button>
            <button className={`tab-button ${activeTab === 'calendar' ? 'active' : ''}`} onClick={() => setActiveTab('calendar')}>🗓️ 財經日曆</button>
            <button className={`tab-button ${activeTab === 'trump' ? 'active' : ''}`} onClick={() => setActiveTab('trump')}>🦅 川普動態</button>
        </div>
        
        <div className="tab-content">
            {error ? (
                <div className="error-container">
                    <h2>糟糕，出錯了！</h2>
                    <p>{error}</p>
                </div>
            ) : (
                <>
                    {activeTab === 'news' && (
                        <div className="news-container">
                            {renderNews("主要財經新聞", dashboardData.financialNews, loading.news)}
                            {renderNews("加密貨幣新聞", dashboardData.cryptoNews, loading.news)}
                        </div>
                    )}
                    {activeTab === 'calendar' && renderCalendar(dashboardData.calendar, loading.calendar)}
                    {activeTab === 'trump' && renderTrumpTracker(dashboardData.trumpTracker, loading.trump)}
                </>
            )}
        </div>
      </main>
    </div>
  );
};

const container = document.getElementById("root");
const root = createRoot(container!);
root.render(<App />);
