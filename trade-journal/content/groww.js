// TradeLog — Groww Content Script

(function () {
  'use strict';

  console.log('[TradeLog] Groww monitoring active');

  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const method = ((init && init.method) || 'GET').toUpperCase();

    return originalFetch.apply(this, arguments).then(response => {
      if (method === 'POST' && /order|trade|place/i.test(url) && response.ok) {
        response.clone().json().then(data => {
          if (data && (data.status === 'SUCCESS' || data.orderid || data.orderId || data.data)) {
            const body = init && init.body;
            parseGrowwOrder(body, data);
          }
        }).catch(() => {});
      }
      return response;
    }).catch(err => { throw err; });
  };

  function parseGrowwOrder(body, responseData) {
    try {
      let params = {};
      if (typeof body === 'string') {
        try { params = JSON.parse(body); } catch (e) {
          new URLSearchParams(body).forEach((v, k) => { params[k] = v; });
        }
      }

      const trade = {
        orderId: responseData.orderId || responseData.orderid || responseData.data?.orderId || '',
        symbol: params.tradingSymbol || params.symbol || params.scripName || extractSymbolFromPage(),
        exchange: params.exchange || 'NSE',
        action: (params.transactionType || params.orderSide || params.type || 'BUY').toUpperCase(),
        quantity: parseInt(params.quantity || params.qty || 1),
        price: parseFloat(params.price || params.limitPrice || 0),
        orderType: params.orderType || 'MARKET',
        product: params.segment === 'FNO' ? 'FNO' : (params.orderType === 'DELIVERY' ? 'CNC' : 'MIS')
      };

      if (trade.symbol) sendTrade(trade, 'groww-api');

    } catch (e) {}
  }

  function extractSymbolFromPage() {
    const el = document.querySelector(
      '[class*="stockName"], [class*="companyName"], h1, [class*="symbol"]'
    );
    return el ? el.innerText.trim().split('\n')[0] : '';
  }

  // DOM fallback — watch for order confirmation modal
  const observer = new MutationObserver(() => {
    const confirmations = document.querySelectorAll(
      '[class*="orderSuccess"], [class*="order-success"], [class*="OrderPlaced"]'
    );
    confirmations.forEach(el => {
      if (isVisible(el)) {
        const symbol = extractSymbolFromPage();
        if (symbol) {
          sendTrade({
            symbol,
            action: detectAction(),
            quantity: 0,
            price: 0,
            orderType: 'MARKET',
            product: 'MIS'
          }, 'groww-dom');
        }
      }
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });

  function detectAction() {
    const buyBtn = document.querySelector('[class*="buyBtn"], [class*="buy-btn"]');
    return buyBtn ? 'BUY' : 'SELL';
  }

  const sentOrders = new Set();

  function sendTrade(trade, method) {
    const dedupeKey = trade.orderId || `${trade.symbol}-${trade.action}-${Math.floor(Date.now() / 5000)}`;
    if (sentOrders.has(dedupeKey)) return;
    sentOrders.add(dedupeKey);
    setTimeout(() => sentOrders.delete(dedupeKey), 30000);

    chrome.runtime.sendMessage({
      type: 'TRADE_DETECTED',
      data: {
        ...trade,
        source: 'groww',
        url: window.location.href,
        detectedBy: method,
        timestamp: Date.now(),
        tradeTime: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        tradeDate: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
      }
    });

    console.log('[TradeLog] Groww trade captured:', trade.action, trade.symbol);
  }

  function isVisible(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

})();
