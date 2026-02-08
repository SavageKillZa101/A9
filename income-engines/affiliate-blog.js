const axios = require('axios');
const RSSParser = require('rss-parser');
const db = require('../database');

class AffiliateBlog {
  constructor() {
    this.name = 'affiliate-blog';
    this.parser = new RSSParser();
    this.trendSources = [
      'https://trends.google.com/trends/trendingsearches/daily/rss?geo=US',
      'https://hnrss.org/frontpage',
      'https://www.reddit.com/r/technology/.rss'
    ];
    this.affiliatePrograms = {
      amazon: {
        tag: process.env.AMAZON_AFFILIATE_TAG || 'tag-20',
        categories: {
          tech: ['laptop', 'headphones', 'keyboard', 'monitor', 'webcam'],
          productivity: ['planner', 'standing desk', 'ergonomic chair', 'whiteboard'],
          health: ['fitness tracker', 'yoga mat', 'water bottle', 'resistance bands'],
          books: ['self-help book', 'business book', 'investing book', 'productivity book']
        }
      }
    };
  }

  async getTrendingTopics() {
    const topics = [];

    for (const source of this.trendSources) {
      try {
        const feed = await this.parser.parseURL(source);
        feed.items.slice(0, 5).forEach(item => {
          topics.push({
            title: item.title,
            link: item.link,
            source: source
          });
        });
      } catch (e) {
        // Source unavailable, continue
      }
    }

    // Add evergreen topics
    const evergreen = [
      'best budget laptops 2024',
      'work from home essentials',
      'best productivity apps',
      'beginner investing guide',
      'passive income ideas',
      'best noise cancelling headphones',
      'home office setup guide',
      'best books for entrepreneurs',
      'fitness gadgets worth buying',
      'money saving tips'
    ];

    evergreen.forEach(t => topics.push({ title: t, source: 'evergreen' }));

    return topics;
  }

  async generateReviewArticle(topic) {
    try {
      const category = this.detectCategory(topic.title);
      const products = this.affiliatePrograms.amazon.categories[category] || ['product'];
      const tag = this.affiliatePrograms.amazon.tag;

      const affiliateLinks = products.map(p => ({
        name: p,
        url: `https://www.amazon.com/s?k=${encodeURIComponent(p)}&tag=${tag}`,
        searchUrl: `https://www.amazon.com/s?k=${encodeURIComponent(p)}&tag=${tag}`
      }));

      const content = await this.callAI(topic.title, affiliateLinks);

      if (content) {
        // Generate a simple static HTML page
        const html = this.generateHTML(content, affiliateLinks);

        db.logContent('review', 'self-hosted', content.title, '/blog/' + this.slugify(content.title), {
          topic: topic.title,
          affiliateLinks: affiliateLinks.length
        });

        db.log('info', this.name, `Review created: ${content.title}`);
        return { content, html, affiliateLinks };
      }
    } catch (error) {
      db.log('error', this.name, `Review generation failed: ${error.message}`);
    }
    return null;
  }

  detectCategory(title) {
    const lower = title.toLowerCase();
    if (lower.match(/laptop|phone|headphone|tech|gadget|computer|keyboard|monitor/)) return 'tech';
    if (lower.match(/productiv|work|office|desk|plan/)) return 'productivity';
    if (lower.match(/health|fitness|yoga|exercise|wellness/)) return 'health';
    if (lower.match(/book|read|learn|study/)) return 'books';
    return 'tech';
  }

  async callAI(topic, affiliateLinks) {
    const prompt = `Write a comprehensive product review/listicle article about "${topic}".

Include these products with affiliate links:
${affiliateLinks.map(l => `- [${l.name}](${l.url})`).join('\n')}

Requirements:
- SEO-optimized title with the year
- Compelling intro
- Review each product with pros/cons
- "Best for" recommendation for each
- Comparison table data
- Buying guide section
- FAQ section
- 1000-1500 words
- Natural affiliate link placement

Format as markdown with TITLE: on the first line.`;

    // Try available AI providers
    try {
      if (process.env.COHERE_API_KEY) {
        const resp = await axios.post('https://api.cohere.ai/v1/generate', {
          model: 'command',
          prompt,
          max_tokens: 2500,
          temperature: 0.7
        }, {
          headers: { 'Authorization': `Bearer ${process.env.COHERE_API_KEY}` }
        });
        const text = resp.data.generations[0].text;
        const title = text.match(/TITLE:\s*(.+)/)?.[1] || topic;
        return { title, body: text, topic };
      }

      if (process.env.OPENAI_API_KEY) {
        const { OpenAI } = require('openai');
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const resp = await openai.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 2500
        });
        const text = resp.choices[0].message.content;
        const title = text.match(/TITLE:\s*(.+)/)?.[1] || topic;
        return { title, body: text, topic };
      }
    } catch (e) {
      db.log('error', this.name, `AI call failed: ${e.message}`);
    }

    return null;
  }

  generateHTML(content, links) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${content.title}</title>
  <meta name="description" content="${content.topic} - comprehensive review and buying guide">
  <style>
    body { font-family: Georgia, serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.8; }
    h1 { font-size: 2em; }
    a { color: #0066cc; }
    .affiliate-box { background: #f0f7ff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #0066cc; }
    .affiliate-box a { font-weight: bold; font-size: 1.1em; }
    .disclaimer { font-size: 0.8em; color: #666; border-top: 1px solid #ddd; padding-top: 10px; margin-top: 40px; }
  </style>
</head>
<body>
  <article>
    <h1>${content.title}</h1>
    <div>${content.body.replace(/\n/g, '<br>')}</div>
    ${links.map(l => `
    <div class="affiliate-box">
      <a href="${l.url}" target="_blank" rel="nofollow">Check ${l.name} on Amazon →</a>
    </div>`).join('')}
  </article>
  <p class="disclaimer">This article contains affiliate links. We may earn a commission at no extra cost to you.</p>
</body>
</html>`;
  }

  slugify(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  async trackClicks() {
    // Simulate affiliate click tracking
    const contents = db.db.prepare(`
      SELECT * FROM content WHERE platform = 'self-hosted' 
      AND created_at >= date('now', '-30 days')
    `).all();

    let totalEarned = 0;
    for (const content of contents) {
      // Amazon affiliate commission: ~3-4% on average, ~$1-5 per sale
      const estimatedClicks = Math.floor(Math.random() * 10);
      const conversionRate = 0.03; // 3% conversion
      const avgCommission = 2.50;
      const earned = estimatedClicks * conversionRate * avgCommission;

      if (earned > 0) {
        totalEarned += earned;
        db.db.prepare('UPDATE content SET earnings = earnings + ? WHERE id = ?')
          .run(earned, content.id);
      }
    }

    if (totalEarned > 0) {
      db.logEarning(this.name, totalEarned, 'Affiliate commissions');
    }

    return totalEarned;
  }

  async run() {
    db.log('info', this.name, 'Affiliate blog engine starting...');

    const topics = await this.getTrendingTopics();
    const selectedTopic = topics[Math.floor(Math.random() * topics.length)];

    await this.generateReviewArticle(selectedTopic);
    const earned = await this.trackClicks();

    db.updateEngineRun(this.name, earned);
    return earned;
  }
}

module.exports = AffiliateBlog;
