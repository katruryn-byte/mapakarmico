const { MercadoPagoConfig, Payment } = require('mercadopago');
const { createClient } = require('redis');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).json({ status: 'ok' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    const query = req.query;
    console.log('Webhook body:', JSON.stringify(body));
    console.log('Webhook query:', JSON.stringify(query));

    const redisUrl = process.env.REDIS_URL || process.env.STORAGE_URL;
    let paymentId = null;

    if (body?.type === 'payment' && body?.data?.id) {
      paymentId = body.data.id;
    } else if (query?.topic === 'payment' && query?.id) {
      paymentId = query.id;
    } else if (body?.type === 'merchant_order' || query?.topic === 'merchant_order') {
      const orderId = body?.data?.id || query?.id;
      if (!orderId) return res.status(200).json({ status: 'no_order_id' });

      const mpResponse = await fetch(`https://api.mercadopago.com/merchant_orders/${orderId}`, {
        headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` }
      });
      const orderData = await mpResponse.json();
      const pagamentosAprovados = (orderData.payments || []).filter(p => p.status === 'approved');
      if (pagamentosAprovados.length === 0) return res.status(200).json({ status: 'pending_payment' });
      paymentId = pagamentosAprovados[0].id;

      if (orderData.external_reference) {
        const sessionId = orderData.external_reference;
        const redisClient = createClient({ url: redisUrl });
        redisClient.on('error', err => console.error('Redis:', err));
        await redisClient.connect();
        const existing = await redisClient.get(`session:${sessionId}`);
        const sessionObj = existing ? JSON.parse(existing) : {};
        sessionObj.status = 'approved';
        sessionObj.paymentId = String(paymentId);
        sessionObj.paidAt = new Date().toISOString();
        await redisClient.setEx(`session:${sessionId}`, 7200, JSON.stringify(sessionObj));
        await redisClient.quit();
        console.log('Sessão aprovada via merchant_order:', sessionId);
        return res.status(200).json({ status: 'success' });
      }
      return res.status(200).json({ status: 'no_external_reference' });
    } else {
      return res.status(200).json({ status: 'ignored' });
    }

    if (!paymentId) return res.status(200).json({ status: 'no_payment_id' });

    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const paymentClient = new Payment(client);
    const payment = await paymentClient.get({ id: paymentId });

    if (payment.status !== 'approved') return res.status(200).json({ status: 'not_approved' });

    const sessionId = payment.external_reference;
    if (!sessionId) return res.status(200).json({ status: 'no_session' });

    const redisClient = createClient({ url: redisUrl });
    redisClient.on('error', err => console.error('Redis:', err));
    await redisClient.connect();
    const existing = await redisClient.get(`session:${sessionId}`);
    const sessionObj = existing ? JSON.parse(existing) : {};
    sessionObj.status = 'approved';
    sessionObj.paymentId = String(paymentId);
    sessionObj.paidAt = new Date().toISOString();
    await redisClient.setEx(`session:${sessionId}`, 7200, JSON.stringify(sessionObj));
    await redisClient.quit();
    console.log('Sessão aprovada:', sessionId);
    return res.status(200).json({ status: 'success' });

  } catch (error) {
    console.error('Webhook erro:', error.message);
    return res.status(200).json({ status: 'error', message: error.message });
  }
}
