// TradeLog — Background Service Worker
// Receives trades, calculates P&L, tracks stats, updates badge

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TRADE_DETECTED') {
    saveTrade(message.data);
    sendResponse({ success: true });
  }
  if (message.type === 'ORDER_MODIFIED') {
    handleModification(message.data);
    sendResponse({ success: true });
  }
  return true;
});

async function saveTrade(tradeData) {
  try {
    const result = await chrome.storage.local.get(['trades']);
    const trades = result.trades || [];

    // Deduplicate — same orderId or same symbol+action within 5 seconds
    const isDuplicate = trades.some(t => {
      if (tradeData.orderId && t.orderId === tradeData.orderId) return true;
      const sameSymbolAction = t.symbol === tradeData.symbol && t.action === tradeData.action;
      const within5s = Math.abs(t.timestamp - tradeData.timestamp) < 5000;
      return sameSymbolAction && within5s;
    });

    if (isDuplicate) {
      console.log('[TradeLog] Duplicate trade ignored:', tradeData.symbol);
      return;
    }

    // Calculate trade value
    const tradeValue = tradeData.quantity * tradeData.price;

    const newTrade = {
      id: generateId(),
      orderId: tradeData.orderId || '',
      symbol: tradeData.symbol || 'UNKNOWN',
      exchange: tradeData.exchange || 'NSE',
      action: tradeData.action || 'BUY', // BUY or SELL
      quantity: tradeData.quantity || 0,
      price: tradeData.price || 0,
      tradeValue: tradeValue,
      orderType: tradeData.orderType || 'MARKET',
      product: tradeData.product || 'MIS',
      source: tradeData.source || 'unknown',
      timestamp: tradeData.timestamp || Date.now(),
      tradeTime: tradeData.tradeTime || new Date().toLocaleTimeString('en-IN'),
      tradeDate: tradeData.tradeDate || new Date().toLocaleDateString('en-IN'),
      status: 'COMPLETE',
      emotion: '', // trader can tag: confident / fearful / FOMO / disciplined
      notes: '',
      pnl: null // calculated when matching BUY/SELL found
    };

    // Try to calculate P&L by matching with open position
    const pnl = calculatePnL(newTrade, trades);
    if (pnl !== null) newTrade.pnl = pnl;

    trades.unshift(newTrade);

    // Keep last 1000 trades
    const trimmed = trades.slice(0, 1000);
    await chrome.storage.local.set({ trades: trimmed });

    // Update stats
    await updateStats(trimmed);

    // Update badge — today's trade count
    updateBadge(trimmed);

    // Show notification
    showTradeNotification(newTrade);

    console.log('[TradeLog] Trade saved:', newTrade.action, newTrade.quantity, newTrade.symbol, '@₹', newTrade.price);

  } catch (err) {
    console.error('[TradeLog] Error saving trade:', err);
  }
}

// ── P&L CALCULATION ──
// Match SELL with earliest BUY for same symbol (FIFO method)

function calculatePnL(newTrade, existingTrades) {
  if (newTrade.action !== 'SELL' || !newTrade.price) return null;

  // Find matching BUY for same symbol today
  const today = new Date().toDateString();
  const matchingBuy = existingTrades.find(t =>
    t.symbol === newTrade.symbol &&
    t.action === 'BUY' &&
    new Date(t.timestamp).toDateString() === today &&
    t.pnl === null
  );

  if (!matchingBuy || !matchingBuy.price) return null;

  const pnl = (newTrade.price - matchingBuy.price) * newTrade.quantity;
  return Math.round(pnl * 100) / 100; // Round to 2 decimal places
}

// ── STATS CALCULATION ──

async function updateStats(trades) {
  const today = new Date().toDateString();
  const todayTrades = trades.filter(t => new Date(t.timestamp).toDateString() === today);

  // Today's P&L (only completed round trips)
  const todayPnL = todayTrades
    .filter(t => t.pnl !== null)
    .reduce((sum, t) => sum + t.pnl, 0);

  // Win rate (trades with positive P&L)
  const completedTrades = trades.filter(t => t.pnl !== null);
  const winners = completedTrades.filter(t => t.pnl > 0).length;
  const winRate = completedTrades.length > 0
    ? Math.round((winners / completedTrades.length) * 100)
    : 0;

  // Best and worst trade
  const pnlTrades = completedTrades.map(t => t.pnl);
  const bestTrade = pnlTrades.length > 0 ? Math.max(...pnlTrades) : 0;
  const worstTrade = pnlTrades.length > 0 ? Math.min(...pnlTrades) : 0;

  // Total P&L all time
  const totalPnL = completedTrades.reduce((sum, t) => sum + t.pnl, 0);

  const stats = {
    todayTrades: todayTrades.length,
    todayPnL: Math.round(todayPnL * 100) / 100,
    totalTrades: trades.length,
    totalPnL: Math.round(totalPnL * 100) / 100,
    winRate,
    winners,
    losers: completedTrades.length - winners,
    bestTrade: Math.round(bestTrade * 100) / 100,
    worstTrade: Math.round(worstTrade * 100) / 100,
    lastUpdated: Date.now()
  };

  await chrome.storage.local.set({ stats });
}

// ── BADGE ──

function updateBadge(trades) {
  const today = new Date().toDateString();
  const todayCount = trades.filter(t => new Date(t.timestamp).toDateString() === today).length;

  chrome.action.setBadgeText({ text: todayCount > 0 ? String(todayCount) : '' });

  // Green badge if profitable today, red if loss, blue if no P&L yet
  const todayPnL = trades
    .filter(t => new Date(t.timestamp).toDateString() === today && t.pnl !== null)
    .reduce((sum, t) => sum + t.pnl, 0);

  const color = todayPnL > 0 ? '#34C77B' : todayPnL < 0 ? '#FF5A5A' : '#4F7EFF';
  chrome.action.setBadgeBackgroundColor({ color });
}

// ── NOTIFICATION ──

function showTradeNotification(trade) {
  const pnlText = trade.pnl !== null
    ? ` | P&L: ${trade.pnl >= 0 ? '+' : ''}₹${trade.pnl}`
    : '';

  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: `${trade.action} ${trade.symbol} ✓`,
    message: `${trade.quantity} qty @ ₹${trade.price}${pnlText}`,
    priority: 0,
    silent: true
  });
}

// ── ORDER MODIFICATION ──

async function handleModification(data) {
  const result = await chrome.storage.local.get(['trades']);
  const trades = result.trades || [];

  const idx = trades.findIndex(t => t.orderId === data.orderId);
  if (idx !== -1) {
    trades[idx].status = data.action;
    await chrome.storage.local.set({ trades });
  }
}

// ── UTILS ──

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// Reset badge text at midnight
function scheduleMidnightReset() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '' });
    scheduleMidnightReset();
  }, midnight - now);
}

scheduleMidnightReset();
