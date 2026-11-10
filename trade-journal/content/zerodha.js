// TradeLog — Zerodha Kite Content Script
// Silently intercepts every trade execution on kite.zerodha.com
// Zero clicks needed from the trader

(function () {
  'use strict';

  console.log('[TradeLog] Zerodha Kite monitoring active');

  // ── STRATEGY 1: Intercept Zerodha's Order API (most reliable) ──
  // Zerodha Kite fires POST to /api/orders when you place a trade
  // We intercept the response which contains full order details

  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const method = ((init && init.method) || 'GET').toUpperCase();

    return originalFetch.apply(this, arguments).then(response => {

      // Zerodha order placement endpoint
      if (method === 'POST' && /\/api\/orders|\/oms\/orders/i.test(url)) {
        response.clone().json().then(data => {
          if (data && (data.status === 'success' || data.order_id || data.data)) {
            // Extract order details from request body
            const body = init && init.body;
            if (body) {
              parseAndSendZerodhaOrder(body, data, url);
            }
          }
        }).catch(() => {});
      }

      // Zerodha order modification/cancel
      if ((method === 'PUT' || method === 'DELETE') && /\/api\/orders/i.test(url)) {
        response.clone().json().then(data => {
          if (data && data.status === 'success') {
            const body = init && init.body;
            const orderId = url.split('/').pop();
            sendModification(method, orderId, body);
          }
        }).catch(() => {});
      }

      return response;
    }).catch(err => { throw err; });
  };

  // Also intercept XHR (Zerodha uses both)
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._tlMethod = method;
    this._tlUrl = url;
    return originalXHROpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    this.addEventListener('load', function () {
      if ((this._tlMethod || '').toUpperCase() === 'POST' &&
          /\/api\/orders|\/oms\/orders/i.test(this._tlUrl || '')) {
        try {
          const data = JSON.parse(this.responseText);
          if (data && (data.status === 'success' || data.order_id)) {
            parseAndSendZerodhaOrder(body, data, this._tlUrl);
          }
        } catch (e) {}
      }
    });
    return originalXHRSend.apply(this, arguments);
  };

  // ── STRATEGY 2: Watch order book for new confirmed orders ──
  // As a fallback, watch the DOM for new rows in the order book

  let lastOrderCount = 0;

  const orderObserver = new MutationObserver(() => {
    checkOrderBook();
  });

  orderObserver.observe(document.body, {
    childList: true,
    subtree: true
  });

  function checkOrderBook() {
    // Zerodha order book rows
    const orderRows = document.querySelectorAll(
      '.orders tr[class*="order"], ' +
      '[class*="order-row"], ' +
      'tr[data-order-id], ' +
      '[class*="orders-table"] tbody tr'
    );

    if (orderRows.length > lastOrderCount && lastOrderCount > 0) {
      // New order appeared — extract from DOM
      const newRow = orderRows[0]; // Most recent is first
      extractFromOrderRow(newRow);
    }
    lastOrderCount = orderRows.length;
  }

  function extractFromOrderRow(row) {
    if (!row) return;
    const cells = row.querySelectorAll('td');
    if (cells.length < 4) return;

    const text = Array.from(cells).map(c => c.innerText.trim());

    // Zerodha order book columns: Time, Type, Instrument, Product, Qty, Price, Status
    const trade = {
      symbol: text[2] || text[1] || '',
      action: /sell/i.test(text[1] || '') ? 'SELL' : 'BUY',
      quantity: parseInt(text[4]) || 0,
      price: parseFloat(text[5]) || 0,
      product: text[3] || 'MIS',
      status: text[text.length - 1] || 'COMPLETE'
    };

    if (trade.symbol && /complete|traded/i.test(trade.status)) {
      sendTrade(trade, 'dom-orderbook');
    }
  }

  // ── PARSE ORDER FROM API BODY ──

  function parseAndSendZerodhaOrder(body, responseData, url) {
    try {
      let params = {};

      // Body can be FormData string or URLSearchParams
      if (typeof body === 'string') {
        new URLSearchParams(body).forEach((v, k) => { params[k] = v; });
      } else if (body instanceof FormData) {
        body.forEach((v, k) => { params[k] = v; });
      }

      const orderId = responseData.data || responseData.order_id || '';

      const trade = {
        orderId: String(orderId),
        symbol: params.tradingsymbol || params.symbol || '',
        exchange: params.exchange || 'NSE',
        action: (params.transaction_type || params.side || 'BUY').toUpperCase(),
        quantity: parseInt(params.quantity || params.qty || 0),
        price: parseFloat(params.price || params.trigger_price || 0),
        orderType: params.order_type || 'MARKET',
        product: params.product || 'MIS', // MIS=intraday, CNC=delivery, NRML=F&O
        validity: params.validity || 'DAY'
      };

      if (trade.symbol) {
        sendTrade(trade, 'api-intercept');
      }

    } catch (e) {
      console.error('[TradeLog] Parse error:', e);
    }
  }

  function sendModification(method, orderId, body) {
    chrome.runtime.sendMessage({
      type: 'ORDER_MODIFIED',
      data: {
        orderId,
        action: method === 'DELETE' ? 'CANCELLED' : 'MODIFIED',
        source: 'zerodha',
        timestamp: Date.now()
      }
    });
  }

  // ── SEND TO BACKGROUND ──

  const sentOrders = new Set();

  function sendTrade(trade, method) {
    // Deduplicate by orderId or symbol+action+time window
    const dedupeKey = trade.orderId || `${trade.symbol}-${trade.action}-${Math.floor(Date.now() / 5000)}`;
    if (sentOrders.has(dedupeKey)) return;
    sentOrders.add(dedupeKey);

    // Clear old dedup keys after 30 seconds
    setTimeout(() => sentOrders.delete(dedupeKey), 30000);

    const payload = {
      ...trade,
      source: 'zerodha',
      url: window.location.href,
      detectedBy: method,
      timestamp: Date.now(),
      tradeTime: new Date().toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }),
      tradeDate: new Date().toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      })
    };

    chrome.runtime.sendMessage({
      type: 'TRADE_DETECTED',
      data: payload
    });

    console.log('[TradeLog] Trade captured via', method, ':', trade.action, trade.quantity, trade.symbol, '@', trade.price);
  }

})();
