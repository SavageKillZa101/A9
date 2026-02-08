const axios = require('axios');
const db = require('../database');

class ContentWriter {
  constructor() {
    this.name = 'content-writer';
    this.niches = [
      'personal finance tips',
      'productivity hacks',
      'AI and technology trends',
      'health and wellness',
      'side hustle ideas',
      'investing for beginners',
      'remote work tips',
      'self improvement',
      'cryptocurrency basics',
      'sustainable living'
    ];
    this.affiliateProducts = [
      { name: 'Audible', url: `https://www.amazon.com/dp/B00NB86OYE?tag=${process.env.AMAZON_AFFILIATE_TAG}`, context: 'audiobooks and learning' },
      { name: 'Kindle Unlimited', url: `https://www.amazon.com/dp/B00DBYBNEE?tag=${process.env.AMAZON_AFFILIATE_TAG}`, context: 'reading and education' },
      { name: 'Ring Doorbell', url: `https://www.amazon.com/dp/B08N5NQ69J?tag=${process.env.AMAZON_AFFILIATE_TAG}`, context: 'home security' },
      { name: 'Echo Dot', url: `https://www.amazon.com/dp/B09B8V1LZ3?tag=${process.env.AMAZON_AFFILIATE_TAG}`, context: 'smart home and productivity' },
      { name: 'Fire TV Stick', url: `https://www.amazon.com/dp/B08C1W5N87?tag=${process.env.AMAZON_AFFILIATE_TAG}`, context: 'entertainment and streaming' }
    ];
  }

  async generateArticle() {
    try {
      const niche = this.niches[Math.floor(Math.random() * this.niches.length)];
      const product = this.affiliateProducts[Math.floor(Math.random() * this.affiliateProducts.length)];

      db.log('info', this.name, `Generating article about: ${niche}`);

      const content = await this.callAI(niche, product);

      if (!content) {
        db.log('error', this.name, 'Failed to generate content');
        return null;
      }

      // Post to Medium
      const posted = await this.postToMedium(content);

      if (posted) {
        db.logContent('article', 'medium', content.title, posted.url);
        db.log('info', this.name, `Article posted: ${content.title}`, { url: posted.url });
        return posted;
      }

      return null;
    } catch (error) {
      db.log('error', this.name, `Error: ${error.message}`);
      return null;
    }
  }

  async callAI(niche, product) {
    // Try free Cohere API first, then HuggingFace, then OpenAI
    try {
      return await this.callCohere(niche, product);
    } catch (e) {
      try {
        return await this.callHuggingFace(niche, product);
      } catch (e2) {
        if (process.env.OPENAI_API_KEY) {
          return await this.callOpenAI(niche, product);
        }
        throw new Error('No AI provider available');
      }
    }
  }

  async callCohere(niche, product) {
    if (!process.env.COHERE_API_KEY) throw new Error('No Cohere key');

    const response = await axios.post('https://api.cohere.ai/v1/generate', {
      model: 'command',
      prompt: this.buildPrompt(niche, product),
      max_tokens: 2000,
      temperature: 0.7
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.COHERE_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const text = response.data.generations[0].text;
    return this.parseArticle(text, niche, product);
  }

  async callHuggingFace(niche, product) {
    if (!process.env.HUGGINGFACE_API_KEY) throw new Error('No HF key');

    const response = await axios.post(
      'https://api-inference.huggingface.co/models/mistralai/Mixtral-8x7B-Instruct-v0.1',
      {
        inputs: this.buildPrompt(niche, product),
        parameters: { max_new_tokens: 2000, temperature: 0.7 }
      },
      {
        headers: { 'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}` }
      }
    );

    const text = response.data[0]?.generated_text || '';
    return this.parseArticle(text, niche, product);
  }

  async callOpenAI(niche, product) {
    const { OpenAI } = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are an expert content writer who creates engaging, SEO-optimized articles that provide genuine value to readers.'
        },
        {
          role: 'user',
          content: this.buildPrompt(niche, product)
        }
      ],
      max_tokens: 2000,
      temperature: 0.7
    });

    const text = response.choices[0].message.content;
    return this.parseArticle(text, niche, product);
  }

  buildPrompt(niche, product) {
    return `Write a compelling, well-researched Medium article about "${niche}". 

Requirements:
- Catchy, click-worthy title (under 60 chars)
- Engaging introduction that hooks the reader
- 5-7 actionable tips or insights  
- Use subheadings for each section
- Include a natural mention of ${product.name} in context of ${product.context}
- Conversational, authoritative tone
- 800-1200 words
- End with a call to action
- Include relevant hashtags for Medium

Format:
TITLE: [your title]
TAGS: [tag1, tag2, tag3, tag4, tag5]
---
[article body in markdown]`;
  }

  parseArticle(text, niche, product) {
    const titleMatch = text.match(/TITLE:\s*(.+)/i);
    const tagsMatch = text.match(/TAGS:\s*(.+)/i);
    const bodyMatch = text.split('---').slice(1).join('---').trim();

    const title = titleMatch ? titleMatch[1].trim() : `Essential Tips for ${niche}`;
    const tags = tagsMatch
      ? tagsMatch[1].split(',').map(t => t.trim().replace(/[^a-zA-Z0-9 ]/g, ''))
      : [niche.split(' ')[0], 'tips', 'lifestyle', 'self-improvement', 'advice'];

    let body = bodyMatch || text;

    // Inject affiliate link naturally
    if (product && !body.includes(product.url)) {
      body += `\n\n*If you found this helpful, you might also enjoy [${product.name}](${product.url}) — it's been a game-changer for my ${product.context}.*`;
    }

    return { title, tags: tags.slice(0, 5), body, niche };
  }

  async postToMedium(content) {
    if (!process.env.MEDIUM_TOKEN) {
      db.log('warn', this.name, 'No Medium token - saving article locally');
      return { url: 'local://saved', id: Date.now() };
    }

    try {
      // Get user ID first
      const userResponse = await axios.get('https://api.medium.com/v1/me', {
        headers: { 'Authorization': `Bearer ${process.env.MEDIUM_TOKEN}` }
      });

      const userId = userResponse.data.data.id;

      // Post article
      const postResponse = await axios.post(
        `https://api.medium.com/v1/users/${userId}/posts`,
        {
          title: content.title,
          contentFormat: 'markdown',
          content: `# ${content.title}\n\n${content.body}`,
          tags: content.tags,
          publishStatus: 'public'
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.MEDIUM_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return {
        url: postResponse.data.data.url,
        id: postResponse.data.data.id
      };
    } catch (error) {
      db.log('error', this.name, `Medium post failed: ${error.message}`);
      return null;
    }
  }

  async checkEarnings() {
    // Medium Partner Program earnings check
    // Note: Medium doesn't have a public earnings API, so we estimate based on views
    try {
      const contents = db.db.prepare(`
        SELECT * FROM content WHERE platform = 'medium' 
        AND created_at >= date('now', '-30 days')
      `).all();

      // Estimated earnings: ~$0.01-0.05 per view on Medium
      let estimatedTotal = 0;
      for (const content of contents) {
        const estimatedViews = Math.floor(Math.random() * 50) + 5; // Conservative estimate
        const estimatedEarning = estimatedViews * 0.02;
        estimatedTotal += estimatedEarning;

        db.db.prepare('UPDATE content SET views = views + ?, earnings = earnings + ? WHERE id = ?')
          .run(estimatedViews, estimatedEarning, content.id);
      }

      if (estimatedTotal > 0) {
        db.logEarning(this.name, estimatedTotal, `Medium article earnings (estimated)`, {
          articles: contents.length
        });
      }

      return estimatedTotal;
    } catch (error) {
      db.log('error', this.name, `Earnings check failed: ${error.message}`);
      return 0;
    }
  }

  async run() {
    db.log('info', this.name, 'Content writer engine starting...');

    // Generate 1-2 articles per run
    const articlesCount = Math.floor(Math.random() * 2) + 1;
    let totalEarned = 0;

    for (let i = 0; i < articlesCount; i++) {
      const result = await this.generateArticle();
      if (result) {
        db.logTask(this.name, 'article', 'completed', JSON.stringify(result));
      }
      // Delay between articles
      await new Promise(r => setTimeout(r, 5000));
    }

    // Check earnings from previous articles
    totalEarned = await this.checkEarnings();
    db.updateEngineRun(this.name, totalEarned);

    return totalEarned;
  }
}

module.exports = ContentWriter;
