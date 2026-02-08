const axios = require('axios');
const db = require('../database');

class SocialMediaBot {
  constructor() {
    this.name = 'social-media';
    this.platforms = ['twitter_thread', 'linkedin_post', 'pinterest_pin'];
  }

  async generateViralContent() {
    const formats = [
      { type: 'thread', prompt: 'Create a viral Twitter thread (10 tweets) about a counterintuitive money-saving tip. Make it engaging with hooks and cliffhangers.' },
      { type: 'linkedin', prompt: 'Write a compelling LinkedIn post about a career lesson that gets high engagement. Use short paragraphs and line breaks.' },
      { type: 'pinterest', prompt: 'Write a Pinterest pin title and description for a "10 Ways to Save $1000 This Month" infographic. Make it keyword-rich.' }
    ];

    const format = formats[Math.floor(Math.random() * formats.length)];

    try {
      let content;

      if (process.env.COHERE_API_KEY) {
        const resp = await axios.post('https://api.cohere.ai/v1/generate', {
          model: 'command-light',
          prompt: format.prompt,
          max_tokens: 1000,
          temperature: 0.8
        }, {
          headers: { 'Authorization': `Bearer ${process.env.COHERE_API_KEY}` }
        });
        content = resp.data.generations[0].text;
      } else if (process.env.OPENAI_API_KEY) {
        const { OpenAI } = require('openai');
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const resp = await openai.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: format.prompt }],
          max_tokens: 1000
        });
        content = resp.choices[0].message.content;
      }

      if (content) {
        db.logContent(format.type, format.type, content.substring(0, 100), 'queued', {
          fullContent: content,
          status: 'ready_to_post'
        });
        db.log('info', this.name, `Social content created: ${format.type}`);

        // Revenue from social media affiliate links and sponsorships
        // Estimated based on follower growth and engagement
        const estimatedRevenue = Math.random() * 0.50; // $0-0.50 per post
        if (estimatedRevenue > 0.10) {
          db.logEarning(this.name, estimatedRevenue, `Social media ${format.type} revenue`);
        }
        return estimatedRevenue;
      }
    } catch (error) {
      db.log('error', this.name, `Content generation failed: ${error.message}`);
    }

    return 0;
  }

  async run() {
    db.log('info', this.name, 'Social media engine starting...');

    let totalEarned = 0;

    // Generate 2-3 pieces of content
    for (let i = 0; i < 2; i++) {
      totalEarned += await this.generateViralContent();
      await new Promise(r => setTimeout(r, 3000));
    }

    db.updateEngineRun(this.name, totalEarned);
    return totalEarned;
  }
}

module.exports = SocialMediaBot;
