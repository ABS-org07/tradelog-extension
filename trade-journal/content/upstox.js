// TradeLog — Upstox Content Script

(function () {
  'use strict';

  console.log('[TradeLog] Upstox monitoring active');

  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const method = ((init && init.method) || 'GET').toUpperCase();

    return originalFetch.apply(this, arguments).then(response => {
      if (method === 'POST' && /order|trade/i.test(url) && response.ok) {
        response.clone().json().then(data => {
          if (data && (data.status === 'success' || data.data?.order_id)) {
            const body = init && init.body;
            parseUpstoxOrder(body, data);
          }
        }).catch(() => {});
      }
      return response;
    }).catch(err => { throw err; });
  };

  function parseUpstoxOrder(body, responseData) {
    try {
      let params = {};
      if (typeof body === 'string') {
        try { params = JSON.parse(body); } catch (e) {
          new URLSearchParams(body).forEach((v, k) => { params[k] = v; });
        }
      }

      const trade = {
        orderId: responseData.data?.order_id || '',
        symbol: params.instrument_token || params.tradingsymbol || params.symbol || '',
        exchange: params.exchange || 'NSE',
        action: (params.transaction_type || params.side || 'BUY').toUpperCase(),
        quantity: parseInt(params.quantity || 0),
        price: parseFloat(params.price || 0),
        orderType: params.order_type || 'MARKET',
        product: params.product || 'I' // I=intraday, D=delivery
      };

      if (trade.symbol) sendTrade(trade, 'upstox-api');
    } catch (e) {}
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
        source: 'upstox',
        url: window.location.href,
        detectedBy: method,
        timestamp: Date.now(),
        tradeTime: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        tradeDate: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
      }
    });

    console.log('[TradeLog] Upstox trade captured:', trade.action, trade.symbol);
  }

})();
