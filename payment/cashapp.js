const db = require('../database');

class CashAppManager {
  constructor() {
    this.cashtag = process.env.CASHAPP_CASHTAG;
  }

  // Cash App doesn't have a public API for automated transfers
  // We generate payment request links instead
  generatePaymentLink(amount) {
    if (!this.cashtag) return null;

    const cleanTag = this.cashtag.replace('$', '');
    return `https://cash.app/$${cleanTag}/${amount.toFixed(2)}`;
  }

  getWithdrawalInstructions(amount) {
    return {
      method: 'Cash App',
      cashtag: this.cashtag,
      amount: amount,
      instructions: [
        `1. Open Cash App on your phone`,
        `2. The earnings from various platforms will be deposited to your linked accounts`,
        `3. For direct transfers, platforms like Medium and Redbubble can pay to your bank`,
        `4. Your bank can then be linked to Cash App for instant access`,
        `5. Current pending amount: $${amount.toFixed(2)}`
      ],
      paymentLink: this.generatePaymentLink(amount)
    };
  }

  async requestWithdrawal(amount) {
    db.db.prepare(`
      INSERT INTO withdrawals (platform, amount, destination, status)
      VALUES (?, ?, ?, ?)
    `).run('cashapp', amount, this.cashtag || 'not_configured', 'pending_manual');

    db.log('info', 'cashapp', `Cash App withdrawal requested: $${amount}`);

    return {
      success: true,
      message: 'Cash App withdrawal queued. Funds will be available when platform minimums are met.',
      instructions: this.getWithdrawalInstructions(amount)
    };
  }
}

module.exports = CashAppManager;
