const Parser = require('rss-parser');
const parser = new Parser();

const RSS_FEEDS = [
    "https://www.theverge.com/rss/index.xml", // Tech
    "https://hnrss.org/newest?points=100", // Hacker News (Dev/Tech)
    "https://www.sciencedaily.com/rss/top/science.xml", // Science
    "https://store.steampowered.com/feeds/newreleases.xml", // Gaming
    "https://www.pcgamer.com/rss/", // Gaming
    "https://www.rockpapershotgun.com/feed/news", // Gaming
    "https://www.theonion.com/rss" // Satire
];
// Removed FEEDS object as we use the array now, or I should consolidate logic.
// The previous code had `const FEEDS = ...` and then iterated `Object.entries(FEEDS)`.
// But also had `const RSS_FEEDS = ...`.
// I should unify them into a single list or object.
// The iteration logic was: `for (const [source, url] of Object.entries(FEEDS))`.
// I will change it to iterate the array and use domain as source.

const FEEDS = {
    verge: "https://www.theverge.com/rss/index.xml",
    hackernews: "https://hnrss.org/newest?points=100",
    science: "https://www.sciencedaily.com/rss/top/science.xml",
    steam: "https://store.steampowered.com/feeds/newreleases.xml",
    pcgamer: "https://www.pcgamer.com/rss/",
    rps: "https://www.rockpapershotgun.com/feed/news",
    onion: "https://www.theonion.com/rss"
};

async function fetchNews() {
    const newsItems = [];

    for (const [source, url] of Object.entries(FEEDS)) {
        try {
            const feed = await parser.parseURL(url);
            feed.items.slice(0, 5).forEach(item => { // Limit to 5 per feed
                newsItems.push({
                    source: source,
                    title: item.title,
                    link: item.link,
                    content: item.contentSnippet || item.content || '',
                    image: extractImage(item),
                    pubDate: item.pubDate
                });
            });
        } catch (err) {
            console.error(`Error fetching feed ${source}: `, err.message);
        }
    }

    return newsItems;
}

function extractImage(item) {
    // 1. Check for enclosure (standard RSS)
    if (item.enclosure && item.enclosure.url) {
        return item.enclosure.url;
    }

    // 2. Check for media:content
    if (item['media:content'] && item['media:content'].$ && item['media:content'].$.url) {
        return item['media:content'].$.url;
    }

    // 3. Fallback: Parse first <img> tag from content
    const imgRegex = /<img[^>]+src=["']([^"']+)["']/;
    const match = (item.content || '').match(imgRegex);
    if (match) {
        return match[1];
    }

    return null;
}

module.exports = { fetchNews };
