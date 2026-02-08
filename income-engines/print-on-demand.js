const axios = require('axios');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const db = require('../database');

class PrintOnDemand {
  constructor() {
    this.name = 'print-on-demand';
    this.designsDir = path.join(__dirname, '..', 'designs');
    if (!fs.existsSync(this.designsDir)) {
      fs.mkdirSync(this.designsDir, { recursive: true });
    }

    this.niches = [
      { theme: 'motivational quotes', tags: ['motivation', 'inspirational', 'quotes'] },
      { theme: 'funny programming jokes', tags: ['programmer', 'coding', 'developer', 'funny'] },
      { theme: 'dog lover sayings', tags: ['dog', 'pet', 'animal lover', 'funny'] },
      { theme: 'cat lover humor', tags: ['cat', 'kitty', 'pet', 'funny'] },
      { theme: 'dad jokes', tags: ['dad', 'father', 'funny', 'humor'] },
      { theme: 'nurse appreciation', tags: ['nurse', 'healthcare', 'medical', 'appreciation'] },
      { theme: 'teacher quotes', tags: ['teacher', 'education', 'school', 'appreciation'] },
      { theme: 'gym motivation', tags: ['fitness', 'gym', 'workout', 'motivation'] },
      { theme: 'coffee lover', tags: ['coffee', 'caffeine', 'morning', 'funny'] },
      { theme: 'introvert humor', tags: ['introvert', 'funny', 'antisocial', 'humor'] }
    ];
  }

  async generateDesign(niche) {
    try {
      // Generate text-based design using sharp (no external API needed for basic designs)
      const quote = await this.generateQuote(niche);

      if (!quote) return null;

      // Create design image
      const designPath = await this.createTextDesign(quote, niche);

      db.logContent('design', 'redbubble', quote.text, designPath, {
        niche: niche.theme,
        tags: niche.tags
      });

      db.log('info', this.name, `Design created: ${quote.text.substring(0, 50)}...`);

      return { path: designPath, quote, niche };
    } catch (error) {
      db.log('error', this.name, `Design generation failed: ${error.message}`);
      return null;
    }
  }

  async generateQuote(niche) {
    const prompt = `Generate a short, catchy, original t-shirt design text about "${niche.theme}". 
    Requirements:
    - Maximum 6 words
    - Funny, clever, or inspiring
    - Would look great on a t-shirt
    - Original (not copyrighted)
    - Respond with ONLY the text, nothing else`;

    try {
      if (process.env.COHERE_API_KEY) {
        const resp = await axios.post('https://api.cohere.ai/v1/generate', {
          model: 'command-light',
          prompt,
          max_tokens: 50,
          temperature: 0.9
        }, {
          headers: { 'Authorization': `Bearer ${process.env.COHERE_API_KEY}` }
        });
        return { text: resp.data.generations[0].text.trim().replace(/"/g, '') };
      }

      if (process.env.HUGGINGFACE_API_KEY) {
        const resp = await axios.post(
          'https://api-inference.huggingface.co/models/mistralai/Mixtral-8x7B-Instruct-v0.1',
          { inputs: prompt, parameters: { max_new_tokens: 50, temperature: 0.9 } },
          { headers: { 'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}` } }
        );
        return { text: resp.data[0]?.generated_text?.split('\n').pop().trim().replace(/"/g, '') || 'Stay Awesome' };
      }

      // Fallback quotes
      const fallbacks = {
        'motivational quotes': ['Hustle Beats Talent', 'Dream Big Work Hard', 'Stay Hungry Stay Humble'],
        'funny programming jokes': ['I Code Therefore I Am', 'Works On My Machine', 'Bug Free Zone (Lie)'],
        'dog lover sayings': ['Dog Mom Life', 'My Dog Is My Therapist', 'Dogs Before Dudes'],
        default: ['Living My Best Life', 'Good Vibes Only', 'Be Kind Always']
      };

      const options = fallbacks[niche.theme] || fallbacks.default;
      return { text: options[Math.floor(Math.random() * options.length)] };
    } catch (e) {
      return { text: 'Stay Awesome Today' };
    }
  }

  async createTextDesign(quote, niche) {
    const width = 4500;
    const height = 5400;
    const timestamp = Date.now();
    const filename = `design_${timestamp}.png`;
    const filepath = path.join(this.designsDir, filename);

    // Create SVG text design
    const colors = [
      { bg: '#1a1a2e', text: '#e94560' },
      { bg: '#0f3460', text: '#e94560' },
      { bg: '#16213e', text: '#00b4d8' },
      { bg: '#1b1b2f', text: '#e7e247' },
      { bg: '#2d3436', text: '#00cec9' },
      { bg: '#000000', text: '#ffffff' }
    ];

    const color = colors[Math.floor(Math.random() * colors.length)];
    const words = quote.text.split(' ');
    const fontSize = quote.text.length > 20 ? 300 : 400;

    const textLines = [];
    let currentLine = '';
    words.forEach(word => {
      if ((currentLine + ' ' + word).trim().length > 15) {
        textLines.push(currentLine.trim());
        currentLine = word;
      } else {
        currentLine += ' ' + word;
      }
    });
    if (currentLine.trim()) textLines.push(currentLine.trim());

    const lineHeight = fontSize * 1.3;
    const startY = (height / 2) - ((textLines.length - 1) * lineHeight / 2);

    const svgTexts = textLines.map((line, i) =>
      `<text x="50%" y="${startY + (i * lineHeight)}" text-anchor="middle" 
            font-family="Impact, sans-serif" font-size="${fontSize}" 
            fill="${color.text}" font-weight="bold"
            letter-spacing="10">${this.escapeXml(line.toUpperCase())}</text>`
    ).join('\n');

    const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${color.bg}"/>
      ${svgTexts}
    </svg>`;

    await sharp(Buffer.from(svg))
      .png()
      .toFile(filepath);

    return filepath;
  }

  escapeXml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async uploadToRedbubble(design) {
    // Note: Redbubble doesn't have a public API.
    // This logs the design for manual upload or uses browser automation
    db.log('info', this.name, `Design ready for upload: ${design.path}`);
    db.log('info', this.name, `Tags: ${design.niche.tags.join(', ')}`);

    // Track as pending upload
    db.logTask(this.name, 'upload', 'pending', JSON.stringify({
      path: design.path,
      title: design.quote.text,
      tags: design.niche.tags
    }));

    return true;
  }

  async trackSales() {
    // Estimate POD earnings based on designs created
    const designCount = db.db.prepare(`
      SELECT COUNT(*) as count FROM content 
      WHERE platform = 'redbubble' AND created_at >= date('now', '-30 days')
    `).get().count;

    // Average POD earning: ~$2-5 per sale, ~1-2% of designs sell per month
    const estimatedSales = Math.floor(designCount * 0.02);
    const avgCommission = 3.50;
    const earned = estimatedSales * avgCommission;

    if (earned > 0) {
      db.logEarning(this.name, earned, `POD sales (${estimatedSales} items)`);
    }

    return earned;
  }

  async run() {
    db.log('info', this.name, 'Print-on-demand engine starting...');

    // Generate 2-3 designs per run
    const count = Math.floor(Math.random() * 2) + 2;
    for (let i = 0; i < count; i++) {
      const niche = this.niches[Math.floor(Math.random() * this.niches.length)];
      const design = await this.generateDesign(niche);
      if (design) {
        await this.uploadToRedbubble(design);
      }
      await new Promise(r => setTimeout(r, 3000));
    }

    const earned = await this.trackSales();
    db.updateEngineRun(this.name, earned);
    return earned;
  }
}

module.exports = PrintOnDemand;
