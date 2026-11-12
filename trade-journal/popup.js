// TradeLog — Popup Script v2

let allTrades = [];
let currentFilter = 'today';

document.addEventListener('DOMContentLoaded', () => {
  loadData();
  setupTabs();
  setupClearBtn();
  setupExportBtn();
  updateMarketStatus();
  setupChecklist();
  setupLossLimit();
  setupUpgradeBanner();
});

function setupUpgradeBanner() {
  const banner = document.getElementById('upgrade-banner');
  const upgradeBtn = document.getElementById('upgrade-btn');
  const dismissBtn = document.getElementById('upgrade-dismiss');

  // Check if user is Pro or has dismissed the banner recently
  chrome.storage.local.get(['isPro', 'bannerDismissedAt'], (result) => {
    if (result.isPro) {
      banner.classList.add('hidden');
      return;
    }
    // Hide for 3 days after dismiss
    if (result.bannerDismissedAt) {
      const daysSince = (Date.now() - result.bannerDismissedAt) / (1000 * 60 * 60 * 24);
      if (daysSince < 3) {
        banner.classList.add('hidden');
        return;
      }
    }
  });

  upgradeBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://abs-org07.github.io/tradelog-extension/#pricing' });
  });

  dismissBtn.addEventListener('click', () => {
    banner.classList.add('hidden');
    chrome.storage.local.set({ bannerDismissedAt: Date.now() });
  });
}

function loadData() {
  chrome.storage.local.get(['trades', 'stats'], (result) => {
    allTrades = result.trades || [];
    const stats = result.stats || {};
    updateStatsStrip(stats);
    updateSourceDots();
    renderChart();
    renderTrades(currentFilter);
    if (currentFilter === 'summary') renderSummary();
    if (currentFilter === 'debrief') renderDebrief();
  });
}

// ── STATS STRIP ──

function updateStatsStrip(stats) {
  const todayPnL = stats.todayPnL || 0;
  const pnlEl = document.getElementById('today-pnl');
  pnlEl.textContent = formatPnL(todayPnL);
  pnlEl.className = 'pnl-main-val ' + (todayPnL > 0 ? 'profit' : todayPnL < 0 ? 'loss' : '');

  document.getElementById('today-trades').textContent = stats.todayTrades || 0;
  document.getElementById('win-rate').textContent = (stats.winRate || 0) + '%';

  const totalPnL = stats.totalPnL || 0;
  const totalEl = document.getElementById('total-pnl');
  totalEl.textContent = formatPnL(totalPnL);
  totalEl.className = 'val ' + (totalPnL > 0 ? 'green' : totalPnL < 0 ? 'red' : 'white');

  const footerEl = document.getElementById('footer-text');
  footerEl.textContent = allTrades.length > 0
    ? `${allTrades.length} trade${allTrades.length !== 1 ? 's' : ''} logged`
    : 'Zero clicks needed';
}

// ── 7-DAY CHART ──

function renderChart() {
  const container = document.getElementById('chart-bars');
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d);
  }

  const dayPnLs = days.map(d => {
    const dateStr = d.toDateString();
    const dayTrades = allTrades.filter(t =>
      new Date(t.timestamp).toDateString() === dateStr && t.pnl !== null
    );
    return dayTrades.reduce((sum, t) => sum + t.pnl, 0);
  });

  const maxAbs = Math.max(...dayPnLs.map(v => Math.abs(v)), 1);
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  container.innerHTML = days.map((d, i) => {
    const pnl = dayPnLs[i];
    const heightPct = Math.round((Math.abs(pnl) / maxAbs) * 100);
    const cls = pnl > 0 ? 'profit' : pnl < 0 ? 'loss' : 'zero';
    const dayLabel = `${d.getDate()}/${d.getMonth()+1}`;
    return `
      <div class="chart-bar-wrap" title="${pnl >= 0 ? '+' : ''}₹${pnl.toFixed(0)}">
        <div class="chart-bar ${cls}" style="height:${heightPct}%"></div>
        <div class="chart-day">${dayLabel}</div>
      </div>
    `;
  }).join('');
}

// ── RENDER TRADES ──

function renderTrades(filter) {
  const list = document.getElementById('trade-list');
  const emptyState = document.getElementById('empty-state');
  const summaryView = document.getElementById('summary-view');

  // Handle summary tab separately
  if (filter === 'summary') {
    list.style.display = 'none';
    summaryView.classList.add('active');
    renderSummary();
    return;
  }

  list.style.display = '';
  summaryView.classList.remove('active');

  const today = new Date().toDateString();
  let filtered;

  switch (filter) {
    case 'today':
      filtered = allTrades.filter(t => new Date(t.timestamp).toDateString() === today);
      break;
    case 'winners':
      filtered = allTrades.filter(t => t.pnl !== null && t.pnl > 0);
      break;
    case 'losers':
      filtered = allTrades.filter(t => t.pnl !== null && t.pnl < 0);
      break;
    default:
      filtered = allTrades;
  }

  if (filtered.length === 0) {
    emptyState.classList.add('show');
    list.innerHTML = '';
    list.appendChild(emptyState);
    return;
  }

  emptyState.classList.remove('show');

  list.innerHTML = filtered.map(trade => {
    const isBuy = trade.action === 'BUY';
    const productClass = 'product-' + (trade.product || 'mis').toLowerCase();
    const productLabel = trade.product || 'MIS';

    const pnlHtml = trade.pnl !== null
      ? `<div class="trade-pnl ${trade.pnl >= 0 ? 'green' : 'red'}">${formatPnL(trade.pnl)}</div>`
      : `<div class="trade-pnl" style="color:#3D4255">—</div>`;

    return `
      <div class="trade-item" data-id="${trade.id}">
        <div class="action-badge ${isBuy ? 'action-buy' : 'action-sell'}">
          ${isBuy ? 'BUY' : 'SELL'}
        </div>
        <div class="trade-info">
          <div class="trade-symbol">
            ${escHtml(trade.symbol)}
            <span class="exchange-tag">${trade.exchange || 'NSE'}</span>
            <span class="product-tag ${productClass}">${productLabel}</span>
          </div>
          <div class="trade-detail">
            <span>${trade.quantity} qty</span> @ <span>₹${formatPrice(trade.price)}</span>
            · <span style="color:#3D4255">${trade.source || 'unknown'}</span>
          </div>
          <div class="trade-controls">
            <select class="emotion-select" data-id="${trade.id}" title="Tag emotion">
              <option value="">Tag emotion...</option>
              <option value="disciplined"   ${trade.emotion === 'disciplined'    ? 'selected' : ''}>✅ Disciplined</option>
              <option value="confident"     ${trade.emotion === 'confident'      ? 'selected' : ''}>💪 Confident</option>
              <option value="fomo"          ${trade.emotion === 'fomo'           ? 'selected' : ''}>😰 FOMO</option>
              <option value="revenge"       ${trade.emotion === 'revenge'        ? 'selected' : ''}>😤 Revenge</option>
              <option value="fearful"       ${trade.emotion === 'fearful'        ? 'selected' : ''}>😨 Fearful</option>
              <option value="overconfident" ${trade.emotion === 'overconfident'  ? 'selected' : ''}>🤑 Overconfident</option>
            </select>
            <input class="notes-input" type="text" placeholder="Add note..." data-id="${trade.id}" value="${escHtml(trade.notes || '')}">
          </div>
        </div>
        <div class="trade-right">
          ${pnlHtml}
          <div class="trade-time">${trade.tradeTime || ''}</div>
        </div>
      </div>
    `;
  }).join('');

  // Emotion handlers
  list.querySelectorAll('.emotion-select').forEach(sel => {
    sel.addEventListener('change', (e) => {
      e.stopPropagation();
      updateField(e.target.dataset.id, 'emotion', e.target.value);
    });
  });

  // Notes handlers (save on blur)
  list.querySelectorAll('.notes-input').forEach(input => {
    input.addEventListener('blur', (e) => {
      updateField(e.target.dataset.id, 'notes', e.target.value);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.target.blur();
    });
  });
}

// ── SUMMARY VIEW ──

function renderSummary() {
  const now = new Date();

  // Week start (Monday)
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  weekStart.setHours(0, 0, 0, 0);

  // Month start
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const weekTrades   = allTrades.filter(t => new Date(t.timestamp) >= weekStart);
  const monthTrades  = allTrades.filter(t => new Date(t.timestamp) >= monthStart);

  const weekCompleted  = weekTrades.filter(t => t.pnl !== null);
  const monthCompleted = monthTrades.filter(t => t.pnl !== null);
  const allCompleted   = allTrades.filter(t => t.pnl !== null);

  const weekPnL  = weekCompleted.reduce((s, t) => s + t.pnl, 0);
  const monthPnL = monthCompleted.reduce((s, t) => s + t.pnl, 0);

  const weekWinners  = weekCompleted.filter(t => t.pnl > 0).length;
  const monthWinners = monthCompleted.filter(t => t.pnl > 0).length;
  const allWinners   = allCompleted.filter(t => t.pnl > 0).length;

  const weekWR  = weekCompleted.length  ? Math.round(weekWinners  / weekCompleted.length  * 100) : 0;
  const monthWR = monthCompleted.length ? Math.round(monthWinners / monthCompleted.length * 100) : 0;
  const allWR   = allCompleted.length   ? Math.round(allWinners   / allCompleted.length   * 100) : 0;

  const weekBest = weekCompleted.length ? Math.max(...weekCompleted.map(t => t.pnl)) : 0;
  const monthWorst = monthCompleted.length ? Math.min(...monthCompleted.map(t => t.pnl)) : 0;

  // Best/worst day
  const dayMap = {};
  allCompleted.forEach(t => {
    const d = new Date(t.timestamp).toDateString();
    dayMap[d] = (dayMap[d] || 0) + t.pnl;
  });
  const dayVals = Object.values(dayMap);
  const bestDay  = dayVals.length ? Math.max(...dayVals) : 0;
  const worstDay = dayVals.length ? Math.min(...dayVals) : 0;

  // Update DOM
  setVal('week-pnl',    weekPnL,    true);
  setVal('month-pnl',   monthPnL,   true);
  setVal('all-best-day',  bestDay,  true);
  setVal('all-worst-day', worstDay, true);
  setVal('week-best',   weekBest,   true);
  setVal('month-worst', monthWorst, true);

  document.getElementById('week-trades').textContent  = weekTrades.length;
  document.getElementById('month-trades').textContent = monthTrades.length;
  document.getElementById('all-total-trades').textContent = allTrades.length;
  document.getElementById('week-winrate').textContent  = weekWR + '%';
  document.getElementById('month-winrate').textContent = monthWR + '%';
  document.getElementById('all-winrate').textContent   = allWR + '%';
}

function setVal(id, val, isPnL) {
  const el = document.getElementById(id);
  if (!el) return;
  if (isPnL) {
    el.textContent = formatPnL(val);
    el.className = 's-val ' + (val > 0 ? 'green' : val < 0 ? 'red' : 'white');
  } else {
    el.textContent = val;
  }
}

// ── FIELD UPDATE ──

function updateField(id, field, value) {
  const idx = allTrades.findIndex(t => t.id === id);
  if (idx === -1) return;
  allTrades[idx][field] = value;
  chrome.storage.local.set({ trades: allTrades });
}

// ── EXPORT TO CSV ──

function setupExportBtn() {
  document.getElementById('export-btn').addEventListener('click', exportCSV);
}

function exportCSV() {
  if (allTrades.length === 0) {
    alert('No trades to export yet.');
    return;
  }

  const headers = ['Date', 'Time', 'Symbol', 'Exchange', 'Action', 'Qty', 'Price', 'Value', 'Product', 'P&L', 'Platform', 'Emotion', 'Notes'];
  const rows = allTrades.map(t => [
    t.tradeDate || new Date(t.timestamp).toLocaleDateString('en-IN'),
    t.tradeTime || '',
    t.symbol || '',
    t.exchange || 'NSE',
    t.action || '',
    t.quantity || 0,
    t.price || 0,
    ((t.quantity || 0) * (t.price || 0)).toFixed(2),
    t.product || 'MIS',
    t.pnl !== null ? t.pnl : '',
    t.source || '',
    t.emotion || '',
    (t.notes || '').replace(/,/g, ';') // avoid CSV breaking on commas in notes
  ]);

  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `tradelog_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── MARKET STATUS ──

function updateMarketStatus() {
  const now = new Date();
  const totalMinutes = now.getHours() * 60 + now.getMinutes();
  const day = now.getDay();
  const isWeekday = day >= 1 && day <= 5;
  const isDuringHours = totalMinutes >= (9*60+15) && totalMinutes <= (15*60+30);

  const statusEl = document.getElementById('market-status');
  if (isWeekday && isDuringHours) {
    statusEl.textContent = 'MARKET OPEN';
    statusEl.className = 'market-status market-open';
  } else {
    statusEl.textContent = 'MARKET CLOSED';
    statusEl.className = 'market-status market-closed';
  }
}

// ── SOURCE DOTS ──

function updateSourceDots() {
  ['zerodha', 'groww', 'upstox', 'angelone'].forEach(src => {
    const dot = document.getElementById('dot-' + src);
    if (dot) dot.classList.toggle('active', allTrades.some(t => t.source === src));
  });
}

// ── TABS ──

function setupTabs() {
  document.querySelector('.tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentFilter = tab.dataset.filter;

    const debriefView = document.getElementById('debrief-view');
    const summaryView = document.getElementById('summary-view');
    const tradeList = document.getElementById('trade-list');

    if (currentFilter === 'debrief') {
      debriefView.classList.add('active');
      summaryView.style.display = 'none';
      tradeList.style.display = 'none';
      renderDebrief();
    } else if (currentFilter === 'summary') {
      debriefView.classList.remove('active');
      summaryView.style.display = 'block';
      tradeList.style.display = 'none';
      renderSummary();
    } else {
      debriefView.classList.remove('active');
      summaryView.style.display = 'none';
      tradeList.style.display = 'block';
      renderTrades(currentFilter);
    }
  });
}

// ── DEBRIEF / WHY DID I LOSE ──

function renderDebrief() {
  const today = new Date().toDateString();
  const todayTrades = allTrades.filter(t => new Date(t.timestamp).toDateString() === today);
  const losingTrades = todayTrades.filter(t => t.pnl !== null && t.pnl < 0);
  const winningTrades = todayTrades.filter(t => t.pnl !== null && t.pnl > 0);
  const totalPnL = todayTrades.reduce((s, t) => s + (t.pnl || 0), 0);

  // streak
  updateStreak(todayTrades.length > 0);

  const container = document.getElementById('debrief-analysis');

  if (todayTrades.length === 0) {
    container.innerHTML = `
      <div class="debrief-card neutral">
        <div class="debrief-label">Analysis</div>
        <div class="debrief-value">No trades today yet.</div>
        <div class="debrief-insight neutral">Place trades and come back here after market close.</div>
      </div>`;
    return;
  }

  let html = '';

  // Overall result
  const resultClass = totalPnL >= 0 ? 'win' : 'loss';
  html += `<div class="debrief-card ${resultClass}">
    <div class="debrief-label">Today's Result</div>
    <div class="debrief-value">${totalPnL >= 0 ? '+' : ''}₹${totalPnL.toFixed(0)} across ${todayTrades.length} trades</div>
    <div class="debrief-insight ${totalPnL >= 0 ? 'positive' : ''}">
      ${totalPnL >= 0 ? '✅ Profitable day! ' + winningTrades.length + ' winners, ' + losingTrades.length + ' losers.' : '❌ Loss day. ' + losingTrades.length + ' losing trades out of ' + todayTrades.length + '.'}
    </div>
  </div>`;

  // Pattern analysis
  if (losingTrades.length > 0) {
    const biggestLoss = losingTrades.reduce((min, t) => t.pnl < min.pnl ? t : min, losingTrades[0]);
    html += `<div class="debrief-card loss">
      <div class="debrief-label">Biggest Loss</div>
      <div class="debrief-value">${biggestLoss.symbol} — ₹${Math.abs(biggestLoss.pnl).toFixed(0)} loss (${biggestLoss.type} ${biggestLoss.qty} qty @ ₹${biggestLoss.price})</div>
      <div class="debrief-insight">Was this your setup or did you force the trade?</div>
    </div>`;
  }

  // Overtrading check
  if (todayTrades.length > 5) {
    html += `<div class="debrief-card loss">
      <div class="debrief-label">⚠️ Overtrading Alert</div>
      <div class="debrief-value">${todayTrades.length} trades in one day</div>
      <div class="debrief-insight">More than 5 trades/day often leads to revenge trading. Review each trade.</div>
    </div>`;
  }

  // Win/loss ratio insight
  if (todayTrades.length >= 2) {
    const winRate = Math.round((winningTrades.length / todayTrades.length) * 100);
    html += `<div class="debrief-card ${winRate >= 50 ? 'win' : 'neutral'}">
      <div class="debrief-label">Win Rate Today</div>
      <div class="debrief-value">${winRate}% (${winningTrades.length} of ${todayTrades.length} trades)</div>
      <div class="debrief-insight ${winRate >= 50 ? 'positive' : 'neutral'}">${winRate >= 60 ? 'Strong execution today.' : winRate >= 40 ? 'Average day. Focus on setup quality.' : 'Review your entries — were you following your rules?'}</div>
    </div>`;
  }

  container.innerHTML = html;
}

function updateStreak(tradedToday) {
  try {
    const data = JSON.parse(localStorage.getItem('tl_streak') || '{"count":0,"lastDate":""}');
    const today = new Date().toDateString();
    if (data.lastDate === today) {
      // already counted
    } else if (tradedToday) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      data.count = data.lastDate === yesterday.toDateString() ? data.count + 1 : 1;
      data.lastDate = today;
      localStorage.setItem('tl_streak', JSON.stringify(data));
    }
    document.getElementById('streak-num').textContent = data.count;
    document.getElementById('streak-msg').textContent =
      data.count === 0 ? 'Trade today to start your streak' :
      data.count < 3 ? 'Keep going!' :
      data.count < 7 ? 'Great consistency!' :
      data.count < 30 ? '🔥 You\'re on fire!' : '🏆 Elite journaler!';
  } catch(e) {}
}

function setupChecklist() {
  try {
    const saved = JSON.parse(localStorage.getItem('tl_checklist') || '{}');
    const today = new Date().toDateString();
    const checks = saved.date === today ? saved.checks : {};
    for (let i = 1; i <= 5; i++) {
      const cb = document.getElementById('c' + i);
      const item = document.getElementById('ci' + i);
      if (!cb) continue;
      cb.checked = !!checks['c' + i];
      if (cb.checked) item.classList.add('checked');
      cb.addEventListener('change', () => {
        item.classList.toggle('checked', cb.checked);
        checks['c' + i] = cb.checked;
        try { localStorage.setItem('tl_checklist', JSON.stringify({ date: today, checks })); } catch(e) {}
      });
    }
  } catch(e) {}
}

// ── LOSS LIMIT SETTING ──

function setupLossLimit() {
  const input = document.getElementById('loss-limit-input');
  const saveBtn = document.getElementById('loss-limit-save');
  const status = document.getElementById('loss-limit-status');
  if (!input || !saveBtn) return;

  // Load saved limit
  chrome.storage.local.get(['lossLimit'], (result) => {
    if (result.lossLimit && result.lossLimit > 0) {
      input.value = result.lossLimit;
      status.textContent = `Active: Stop trading if loss hits ₹${result.lossLimit.toLocaleString('en-IN')} today`;
      status.style.color = '#FF5A5A';
    }
  });

  saveBtn.addEventListener('click', () => {
    const val = parseInt(input.value, 10);
    if (!val || val <= 0) {
      chrome.storage.local.remove('lossLimit', () => {
        status.textContent = 'Loss limit cleared.';
        status.style.color = '#5C6480';
      });
      return;
    }
    chrome.storage.local.set({ lossLimit: val, lossAlertDate: '' }, () => {
      status.textContent = `✅ Set — alert fires if you lose ₹${val.toLocaleString('en-IN')} today`;
      status.style.color = '#34C77B';
      setTimeout(() => {
        status.textContent = `Active: Stop trading if loss hits ₹${val.toLocaleString('en-IN')} today`;
        status.style.color = '#FF5A5A';
      }, 2500);
    });
  });

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveBtn.click(); });
}

// ── CLEAR ──

function setupClearBtn() {
  document.getElementById('clear-btn').addEventListener('click', () => {
    if (confirm('Clear all trade history?')) {
      chrome.storage.local.set({ trades: [], stats: {} }, () => {
        allTrades = [];
        chrome.action.setBadgeText({ text: '' });
        updateStatsStrip({});
        renderChart();
        renderTrades(currentFilter);
      });
    }
  });
}

// ── UTILS ──

function formatPnL(val) {
  if (val === null || val === undefined) return '—';
  const abs = Math.abs(val).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return (val >= 0 ? '+₹' : '-₹') + abs;
}

function formatPrice(price) {
  if (!price) return '0';
  return Number(price).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
