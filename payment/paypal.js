const axios = require('axios');
const db = require('../database');

class PayPalManager {
  constructor() {
    this.clientId = process.env.PAYPAL_CLIENT_ID;
    this.secret = process.env.PAYPAL_SECRET;
    this.baseUrl = process.env.NODE_ENV === 'production'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com';
  }

  async getAccessToken() {
    const response = await axios.post(`${this.baseUrl}/v1/oauth2/token`, 'grant_type=client_credentials', {
      auth: { username: this.clientId, password: this.secret },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    return response.data.access_token;
  }

  async getBalance() {
    try {
      if (!this.clientId || !this.secret) return { available: 0, pending: 0 };

      const token = await this.getAccessToken();
      const response = await axios.get(`${this.baseUrl}/v1/reporting/balances`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const balances = response.data.balances || [];
      const usdBalance = balances.find(b => b.currency === 'USD') || {};

      return {
        available: parseFloat(usdBalance.available?.value || 0),
        pending: parseFloat(usdBalance.pending?.value || 0)
      };
    } catch (error) {
      db.log('error', 'paypal', `Balance check failed: ${error.message}`);
      return { available: 0, pending: 0 };
    }
  }

  async withdraw(amount, destination) {
    try {
      if (!this.clientId || !this.secret) {
        throw new Error('PayPal not configured');
      }

      const token = await this.getAccessToken();

      // PayPal Payouts API
      const response = await axios.post(`${this.baseUrl}/v1/payments/payouts`, {
        sender_batch_header: {
          sender_batch_id: `withdraw_${Date.now()}`,
          email_subject: 'AI Income Engine Withdrawal'
        },
        items: [{
          recipient_type: 'EMAIL',
          amount: { value: amount.toFixed(2), currency: 'USD' },
          receiver: destination || process.env.PAYPAL_EMAIL,
          note: 'AI Income Engine earnings withdrawal'
        }]
      }, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const batchId = response.data.batch_header.payout_batch_id;

      db.db.prepare(`
        INSERT INTO withdrawals (platform, amount, destination, status, transaction_id)
        VALUES (?, ?, ?, ?, ?)
      `).run('paypal', amount, destination || process.env.PAYPAL_EMAIL, 'processing', batchId);

      db.log('info', 'paypal', `Withdrawal initiated: $${amount}`, { batchId });

      return { success: true, batchId };
    } catch (error) {
      db.log('error', 'paypal', `Withdrawal failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}

module.exports = PayPalManager;
