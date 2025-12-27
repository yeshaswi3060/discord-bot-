

## FAQ: Can I use Vercel / Netlify?
**No.**

Vercel is for **Websites**, not Bots.
- **Vercel** shuts down your code after 10 seconds (Serverless).
- **Discord Bots** need to run 24/7 to listen for Voice Channel joins.
- If you use Vercel, your bot will go offline immediately and VC tracking will NOT work.

Stick to **Render** (or Railway/Fly.io) because they offer 'Background Workers' that run forever.
