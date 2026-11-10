// TradeLog — Angel One Content Script

(function () {
  'use strict';

  console.log('[TradeLog] Angel One monitoring active');

  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const method = ((init && init.method) || 'GET').toUpperCase();

    return originalFetch.apply(this, arguments).then(response => {
      if (method === 'POST' && /order|placeorder|trade/i.test(url) && response.ok) {
        response.clone().json().then(data => {
          if (data && (data.status === true || data.message === 'SUCCESS' || data.data?.orderid)) {
            const body = init && init.body;
            parseAngelOrder(body, data);
          }
        }).catch(() => {});
      }
      return response;
    }).catch(err => { throw err; });
  };

  function parseAngelOrder(body, responseData) {
    try {
      let params = {};
      if (typeof body === 'string') {
        try { params = JSON.parse(body); } catch (e) {
          new URLSearchParams(body).forEach((v, k) => { params[k] = v; });
        }
      }

      const trade = {
        orderId: responseData.data?.orderid || '',
        symbol: params.tradingsymbol || params.symbolname || '',
        exchange: params.exchange || 'NSE',
        action: (params.transactiontype || params.side || 'BUY').toUpperCase(),
        quantity: parseInt(params.quantity || 0),
        price: parseFloat(params.price || 0),
        orderType: params.ordertype || 'MARKET',
        product: params.producttype || 'INTRADAY'
      };

      if (trade.symbol) sendTrade(trade, 'angel-api');
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
        source: 'angelone',
        url: window.location.href,
        detectedBy: method,
        timestamp: Date.now(),
        tradeTime: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        tradeDate: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
      }
    });

    console.log('[TradeLog] Angel One trade captured:', trade.action, trade.symbol);
  }

})();
