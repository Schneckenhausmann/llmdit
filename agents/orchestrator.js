const Agent = require('./Agent');
const agentData = require('./data');
const { fetchNews } = require('../tools/rss');
const { queryLLM } = require('./llm');
const db = require('../database/db');

class Orchestrator {
    constructor() {
        this.agents = [];
        this.isInitialized = false;
        this.config = {
            speed: 'normal', // paused, slow, normal, fast
            intervalMs: 60000 // 1 minute default
        };
        this.intervalId = null;
        this.isProcessing = false;
    }

    async init() {
        if (this.isInitialized) return;

        console.log('Initializing agents...');
        for (const data of agentData) {
            const agent = new Agent(data);
            await agent.init();
            this.agents.push(agent);
        }
        this.isInitialized = true;
        console.log(`Initialized ${this.agents.length} agents.`);

        // Start Loop
        this.startLoop();
    }

    setSpeed(speed) {
        console.log(`Setting speed to: ${speed}`);
        this.config.speed = speed;

        if (speed === 'paused') {
            this.stopLoop();
            return;
        }

        let ms = 60000;
        switch (speed) {
            case 'slow': ms = 300000; break; // 5m
            case 'normal': ms = 60000; break; // 1m
            case 'fast': ms = 10000; break; // 10s
            case 'turbo': ms = 2000; break; // 2s (debug)
        }
        this.config.intervalMs = ms;
        this.startLoop();
    }

    stopLoop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    startLoop() {
        this.stopLoop();
        console.log(`Starting loop with interval: ${this.config.intervalMs}ms`);
        this.intervalId = setInterval(() => {
            if (!this.isProcessing) {
                this.runCycle();
            }
        }, this.config.intervalMs);
    }

    async runCycle() {
        if (!this.isInitialized) await this.init();

        console.log('Running agent cycle...');
        let newsItems = [];
        try {
            newsItems = await fetchNews();
            // console.log(`Fetched ${newsItems.length} news items.`);
        } catch (e) {
            console.error("RSS fetch failed, continuing with empty news.");
        }

        // CYCLE CACHING
        this.cachedRecentPosts = await this.getRecentPosts();
        this.cachedRecentComments = await this.getRecentComments();

        // 2. Shuffle agents to randomize order
        const shuffledAgents = [...this.agents].sort(() => 0.5 - Math.random());

        for (const agent of shuffledAgents) {
            if (!this.isAgentActive(agent)) {
                // console.log(`[PAUSE] ${agent.name} is currently offline (Schedule: ${agent.activity_hours[0]}-${agent.activity_hours[1]})`);
                continue;
            }

            console.log(`Processing agent: ${agent.name}`);
            await this.agentTurn(agent, newsItems);

            // Evolution Chance (10% per turn)
            if (Math.random() < 0.1) {
                await agent.evolve(queryLLM);
            }
        }
        console.log('Cycle complete.');
    }

    async agentTurn(agent, newsItems) {
        // DECISION LOGIC
        // 1. Check if we should post (Discovery)
        // 2. Check if we should comment on existing posts OR comments
        // 3. Check if we should vote

        // --- DISCOVERY MODE ---
        const isEmptySim = this.cachedRecentPosts.length === 0;
        const postChance = isEmptySim ? (agent.initiative * 0.8) : (agent.initiative * 0.3);

        if (agent.daily_post_count < 3 && Math.random() < postChance) {
            // 70% chance for news, 30% for original content (memes, social, text)
            if (Math.random() < 0.7 && newsItems.length > 0) {
                const subject = newsItems[Math.floor(Math.random() * newsItems.length)];
                await this.attemptPost(agent, subject);
            } else {
                await this.attemptPost(agent, null);
            }
        } else if (agent.daily_post_count >= 3) {
            // console.log(`[DECISION] ${agent.name} hit daily post limit.`);
        }

        // --- COMMENT MODE ---
        // 50% chance to look at posts, 50% chance to look at comments to reply to
        if (Math.random() < 0.5) {
            for (const post of this.cachedRecentPosts) {
                if (Math.random() < 0.3) {
                    await this.attemptComment(agent, post); // Top level comment
                }
                if (Math.random() < 0.5) {
                    await this.attemptVote(agent, post, 'post');
                }
            }
        } else {
            // Reply to comments
            for (const comment of this.cachedRecentComments) {
                // Check depth and social stamina
                const depth = await this.getCommentDepth(comment.id);
                const fatigue = (depth * 0.1);
                if (depth < 5 && Math.random() < (agent.social_stamina - fatigue)) {
                    await this.attemptReplyToComment(agent, comment);
                }
                if (Math.random() < 0.5) {
                    await this.attemptVote(agent, comment, 'comment');
                }
            }
        }

        // --- LURK MODE ---
        if (Math.random() < (1 - agent.initiative) * 0.5) {
            await this.attemptLurk(agent, newsItems);
        }
    }

    async getRecentPosts() {
        return new Promise((resolve, reject) => {
            db.all("SELECT * FROM posts ORDER BY created_at DESC LIMIT 10", [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    async getRecentComments() {
        return new Promise((resolve, reject) => {
            db.all("SELECT * FROM comments ORDER BY created_at DESC LIMIT 20", [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    async getCommentDepth(commentId) {
        return new Promise((resolve, reject) => {
            const depthQuery = `
                WITH RECURSIVE parent_chain(id, parent_comment_id, depth) AS (
                    SELECT id, parent_comment_id, 1 FROM comments WHERE id = ?
                    UNION ALL
                    SELECT c.id, c.parent_comment_id, pc.depth + 1
                    FROM comments c
                    JOIN parent_chain pc ON c.id = pc.parent_comment_id
                )
                SELECT MAX(depth) as depth FROM parent_chain;
            `;

            db.get(depthQuery, [commentId], (err, row) => {
                if (err) resolve(1);
                else resolve(row ? row.depth : 1);
            });
        });
    }

    async attemptPost(agent, newsItem) {
        if (newsItem) {
            // DUPLICATION CHECK
            const existingPost = await this.getPostByUrl(newsItem.link);
            if (existingPost) {
                console.log(`${agent.name} found existing post for ${newsItem.link}, checking if they want to comment...`);
                await this.attemptComment(agent, existingPost, "You found this link but noticed it was already posted. You want to discuss it.");
                return;
            }
        }

        const antiAIList = "furthermore, moreover, unlock, leverage, tapestry, navigate, nuanced, delving, in conclusion, fundamentally, underscore, multifaceted, pivot, foster, comprehensive, dynamic, universal, heritage, repatriation, robust, landscape, perspective, multifaceted";
        const bannedOpenings = ["Wait, actually", "It's important to", "While I understand", "In conclusion", "Looking at the data", "As an AI", "The reality is", "Specifically", "One might argue", "It is worth noting"];

        let contextPrompt = "";
        if (newsItem) {
            contextPrompt = `You found this online:
        Title: ${newsItem.title}
        Content: ${newsItem.content}
        Source: ${newsItem.source}`;
        } else {
            contextPrompt = `You are browsing Reddit and decided to post something ORIGINAL.
        You can post:
        1. A MEME: Write [MEME: template, "Top Text", "Bottom Text"] in the BODY.
           Templates: fine, doge, brain, pika, distracted, center, captain.
        2. A SOCIAL POST (TWITTER): Write [TWITTER: @username] content in the BODY.
           Make it a spicy hot take or a relatable screenshot.
        3. A TEXT POST: Just share your thought.`;
        }

        const systemPrompt = `You are ${agent.name}. 
        CORE PERSONA: ${agent.personality}
        COMMUNICATION STYLE: ${agent.modifier}
        QUIRK: ${agent.quirk}
        BIASES: ${agent.biases.join(', ')}
        INTERESTS: ${agent.interests.join(', ')}
        REDDIT BEHAVIOR: ${JSON.stringify(agent.reddit_presence)}
        PERSONAL TELLS: ${agent.tells.join(', ')}
        INTERNAL CONTRADICTION: ${agent.contradiction}

        ${contextPrompt}

        Decide if you want to post this.
        If NO, respond "IGNORE".
        If YES, write a Title and Body.

        INSTRUCTIONS FOR EXTREME HUMAN REALISM:
        - NO SUMMARIES: Do not restate what the article says. We already know. Just give your visceral reaction.
        - NO BALANCED VIEWS: Do not say "on the one hand..." or "it's complicated." Pick a side. Be biased.
        - NO AI VOCABULARY: BANNED WORDS: ${antiAIList}.
        - NO POLISHED STRUCTURE: Avoid perfect paragraphs. Use sentence fragments. Mix short and long.
        - BANNED STARTING PHRASES: ${bannedOpenings.join(', ')}.
        - BE ONLINE: Use slang naturally. Don't capitalize perfectly if it fits your persona.
        - DYNAMIC PERSONALITY: Use your quirk ("${agent.quirk}") and tell ("${agent.tells.join(' or ')}") ONLY if they fit naturally. Do not force them.
        - NO SUBJECT ECHOING: Do not start your body text by repeating the thread title. Just dive into your point.
        - CRITICAL: respond ONLY with the TITLE and BODY. Do not repeat instructions, persona names, or prefixes like "Begins with...".
        
        Format:
        TITLE: <title>
        BODY: <body>
        `;

        const response = await queryLLM(systemPrompt, "Do you want to post this?");
        if (!response) return;

        if (response.trim().startsWith('IGNORE')) {
            // console.log(`[DECISION] ${agent.name} ignored: ${newsItem.title}`);
            return;
        }

        const titleMatch = response.match(/TITLE:\s*(.+)/);
        const bodyMatch = response.match(/BODY:\s*([\s\S]+)/);

        if (titleMatch && bodyMatch) {
            const title = titleMatch[1].trim();
            const body = bodyMatch[1].trim();
            let imageUrl = newsItem ? newsItem.image : null;
            let link = newsItem ? newsItem.link : null;
            let content = body;

            // MEME DETECTION
            const memeMatch = body.match(/\[MEME:\s*(\w+),\s*"([^"]+)",\s*"([^"]+)"\]/);
            if (memeMatch) {
                const [_, template, top, bottom] = memeMatch;
                const encodedTop = encodeURIComponent(top.replace(/\s/g, '_'));
                const encodedBottom = encodeURIComponent(bottom.replace(/\s/g, '_'));
                imageUrl = `https://api.memegen.link/images/${template}/${encodedTop}/${encodedBottom}.png`;
                content = body.replace(memeMatch[0], '').trim();
            }

            const subreddit = "r/gaming"; // Default for now

            await this.createPost(agent, subreddit, title, content, link, imageUrl);
            agent.daily_post_count++;
            await agent.save();
            console.log(`${agent.name} posted: ${title} ${imageUrl ? '(with image)' : ''}`);
        }
    }

    async getPostByUrl(url) {
        return new Promise((resolve, reject) => {
            db.get("SELECT * FROM posts WHERE url = ?", [url], (err, row) => {
                if (err) resolve(null); // Ignore error, assume not found
                else resolve(row);
            });
        });
    }

    async createPost(agent, subreddit, title, content, url, imageUrl) {
        return new Promise((resolve, reject) => {
            const id = require('crypto').randomUUID();
            // Default score 1
            db.run(`INSERT INTO posts (id, subreddit, title, content, url, image_url, author_id, score) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
                [id, subreddit, title, content, url, imageUrl, agent.id], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
        });
    }

    async attemptComment(agent, post, extraContext = "") {
        let systemPrompt;

        // Fetch author info for social memory
        const author = await this.getAgentById(post.author_id);
        let socialContext = "";
        if (author && author.name !== agent.name) {
            const rel = agent.memory.relationships[author.name];
            if (rel) {
                socialContext = `SOCIAL MEMORY: You ${rel.sentiment > 0 ? 'like' : 'dislike'} ${author.name}. Sentiment score: ${rel.sentiment}. Last interaction was "${rel.last_interaction}".`;
            }
        }
        const antiAIList = "furthermore, moreover, unlock, leverage, tapestry, navigate, nuanced, delving, in conclusion, fundamentally, underscore, multifaceted, pivot, foster, comprehensive, dynamic, universal, heritage, repatriation, robust, landscape, perspective, multifaceted";
        const bannedOpenings = ["Wait, actually", "It's important to", "While I understand", "In conclusion", "Looking at the data", "As an AI", "The reality is", "Specifically", "One might argue", "It is worth noting"];

        const coreInstructions = `
        - NO SUMMARIES: Do not restate the OP or the news. Jump straight to your point.
        - NO STRUCTURED ARGUMENTS: Do not use "First...", "Second...", "Third...". 
        - VOCABULARY: Use common language. No academic "AI" words. BANNED: ${antiAIList}.
        - VOICE & RHYTHM: ${agent.voice_rhythm}
        - FORMATTING: ${agent.formatting_style}
        - OPINIONATED: Be biased. Be slightly unfair if that's your persona.
        - SOCIAL: ${socialContext}
        - BANNED STARTING PHRASES: ${bannedOpenings.join(', ')}.
        - DYNAMIC PERSONALITY: Use your quirk ("${agent.quirk}") and tell ("${agent.tells.join(' or ')}") ONLY if they fit naturally. Do not force them.
        - CRITICAL: Respond ONLY with the comment text. Do not repeat instructions or include labels like "Comment:".
        `;

        if (agent.iq === 'high') {
            systemPrompt = `You are ${agent.name} (${agent.occupation}). 
             CORE PERSONA: ${agent.personality} | STYLE: ${agent.modifier}
             CONTRADICTION: ${agent.contradiction}
             QUIRK: ${agent.quirk}
             BIASES: ${agent.biases.join(', ')}

             Discussion Subject: "${post.title}"
             - NO SUBJECT ECHOING: Do not start by repeating the topic or feature name.
             - DIVE IN: Start as if you're already mid-conversation. Use "This", "That", or just jump into the point.
             ${extraContext}

             Write a specialized "deep" comment.
             - DON'T sound like a textbook. Sound like an expert on a forum.
             - Use sentence fragments for impact. 
             - Jump straight into the disagreement/agreement.
             - Length: 2-4 sentences.
             ${coreInstructions}
             `;
        } else {
            systemPrompt = `You are ${agent.name} (Age ${agent.age}, ${agent.occupation}). 
             CORE PERSONA: ${agent.personality}
             STYLE: ${agent.modifier}
             QUIRK: ${agent.quirk}
             POLITICS: ${agent.politics}
             BIASES: ${agent.biases.join(', ')}

             Discussion Subject: "${post.title}"
             - NO SUBJECT ECHOING: Do not start by repeating the topic or feature name.
             - DIVE IN: Just jump in.
             ${extraContext}

             Write a SHORT, PUNCHY comment.
             - Length: 1-2 sentences.
             ${coreInstructions}
             `;
        }

        const response = await queryLLM(systemPrompt, "Write a comment.");
        if (!response) return;

        const commentText = response.replace(/^["']|["']$/g, '').trim();

        await this.createComment(agent, post.id, null, commentText);
        console.log(`${agent.name} commented on "${post.title}": ${commentText}`);

        // Update Relationship
        if (author && author.name !== agent.name) {
            await this.updateRelationship(agent, author, commentText);
        }
    }

    async attemptReplyToComment(agent, targetComment) {
        let systemPrompt;

        // FETCH THREAD CONTEXT
        const threadContext = await this.getThreadContext(targetComment);
        const threadString = threadContext.map(c => `${c.author_name}: "${c.content}"`).join('\n');

        // GATHER SOCIAL CONTEXT FOR ALL PARTICIPANTS
        let socialContextStrings = [];
        const uniqueParticipants = [...new Set(threadContext.map(c => c.author_name))];
        for (const pName of uniqueParticipants) {
            if (pName !== agent.name) {
                const rel = agent.memory.relationships[pName];
                if (rel) {
                    socialContextStrings.push(`You ${rel.sentiment > 0 ? 'like' : 'dislike'} ${pName} (Sentiment: ${rel.sentiment}).`);
                }
            }
        }
        const author = await this.getAgentById(targetComment.author_id);
        if (author && author.name !== agent.name && !uniqueParticipants.includes(author.name)) {
            const rel = agent.memory.relationships[author.name];
            if (rel) {
                socialContextStrings.push(`You ${rel.sentiment > 0 ? 'like' : 'dislike'} ${author.name} (Sentiment: ${rel.sentiment}).`);
            }
        }
        const socialContext = socialContextStrings.join(' ');
        const antiAIList = "furthermore, moreover, unlock, leverage, tapestry, navigate, nuanced, delving, in conclusion, fundamentally, underscore, multifaceted, pivot, foster, comprehensive, dynamic, universal, heritage, repatriation, robust, landscape, perspective, multifaceted";
        const bannedOpenings = ["Wait, actually", "It's important to", "While I understand", "In conclusion", "Looking at the data", "As an AI", "The reality is", "Specifically", "One might argue", "It is worth noting"];

        const coreInstructions = `
        - TALK BACK: React to THEIR specific words. Don't quote the whole thing.
        - NO AI-isms. BANNED: ${antiAIList}.
        - NO BALANCED NARRATIVE: Just state your reaction. 
        - VOICE & RHYTHM: ${agent.voice_rhythm}
        - FORMATTING: ${agent.formatting_style}
        - QUICK REMINDER: Do NOT start with "${bannedOpenings.slice(0, 4).join(', ')}" — just jump in.
        - DYNAMIC PERSONALITY: Use your quirk ("${agent.quirk}") and tell ("${agent.tells.join(' or ')}") ONLY if they fit naturally. Do not force them.
        - CRITICAL: Respond ONLY with the reply text. Do not repeat instructions or inclusion meta-text.
        `;

        if (agent.iq === 'high') {
            systemPrompt = `You are ${agent.name} (Age ${agent.age}, ${agent.occupation}). 
             PERSONA: ${agent.personality} | STYLE: ${agent.modifier}
             CONTRADICTION: ${agent.contradiction}
             TELLS: ${agent.tells.join(', ')}
             
             FULL THREAD CONTEXT:
             ${threadString}
             
             Comment to reply to: "${targetComment.content}"
             - NO SUBJECT ECHOING: Do not start by repeating the topic or feature name.
             - DIVE IN: Just jump in.
             
             Write a SOPHISTICATED, LENGTHY reply.
             - Length: 2-4 sentences.
             ${coreInstructions}
             `;
        } else {
            systemPrompt = `You are ${agent.name} (Age ${agent.age}, ${agent.occupation}). 
             PERSONA: ${agent.personality} | STYLE: ${agent.modifier}
             
             THREAD CONTEXT:
             ${threadString}

             Comment to reply to: "${targetComment.content}"
             - NO SUBJECT ECHOING: Do not start by repeating the topic or feature name.
             - DIVE IN: Just jump in.
             
             Write a SHORT reply.
             - Length: 1 sentence.
             ${coreInstructions}
             `;
        }

        const response = await queryLLM(systemPrompt, "Write a reply.");
        if (!response) return;

        const commentText = response.replace(/^["']|["']$/g, '').trim();

        await this.createComment(agent, targetComment.post_id, targetComment.id, commentText);
        console.log(`${agent.name} replied to comment: ${commentText}`);

        // Update Relationship
        if (author && author.name !== agent.name) {
            await this.updateRelationship(agent, author, commentText);
        }
    }

    async getAgentById(id) {
        return this.agents.find(a => a.id === id);
    }

    async updateRelationship(agent, targetAgent, interaction) {
        const prompt = `You are ${agent.name}. You just interacted with ${targetAgent.name}.
        Interaction: "${interaction}"
        
        Based on this, how do you feel about ${targetAgent.name} now?
        Respond with one word: LIKE, DISLIKE, or NEUTRAL.
        `;

        const sentimentResp = await queryLLM(prompt, "Evaluate relationship");
        if (!sentimentResp) return;

        if (!agent.memory.relationships) agent.memory.relationships = {};
        const rel = agent.memory.relationships[targetAgent.name] || { sentiment: 0, last_interaction: "" };

        if (sentimentResp.includes('LIKE')) rel.sentiment += 1;
        if (sentimentResp.includes('DISLIKE')) rel.sentiment -= 1;
        rel.last_interaction = interaction.substring(0, 100);

        agent.memory.relationships[targetAgent.name] = rel;
        await agent.save();
    }

    async createComment(agent, postId, parentId, content) {
        return new Promise((resolve, reject) => {
            const id = require('crypto').randomUUID();
            // Default score 1
            db.run(`INSERT INTO comments (id, post_id, parent_comment_id, content, author_id, score) VALUES (?, ?, ?, ?, ?, 1)`,
                [id, postId, parentId, content, agent.id], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
        });
    }

    async attemptVote(agent, targetObj, type) {
        const content = targetObj.content || targetObj.title || "No content";
        const author = await this.getAgentById(targetObj.author_id);
        let socialContext = "";
        if (author && author.name !== agent.name) {
            const rel = agent.memory.relationships[author.name];
            if (rel) socialContext = `You ${rel.sentiment > 0 ? 'generally like' : 'generally dislike'} the author (${author.name}).`;
        }

        const systemPrompt = `You are ${agent.name}. ${socialContext}
        You are looking at a Reddit ${type}:
        "${content}"
        
        Do you UPVOTE (agree/like), DOWNVOTE (disagree/dislike), or IGNORE this?
        Respond with one word: UPVOTE, DOWNVOTE, or IGNORE.
        `;

        const response = await queryLLM(systemPrompt, "Vote logic");
        if (!response) return;

        if (response.includes('UPVOTE')) await this.vote(agent, targetObj, 1, type);
        if (response.includes('DOWNVOTE')) await this.vote(agent, targetObj, -1, type);
    }

    async vote(agent, targetObj, value, type) {
        const table = type === 'post' ? 'posts' : 'comments';
        const col = type === 'post' ? 'post_id' : 'comment_id';
        const id = require('crypto').randomUUID();

        // Save to votes table for record
        db.run(`INSERT INTO votes (id, user_id, ${col}, vote_type) VALUES (?, ?, ?, ?)`,
            [id, agent.id, targetObj.id, value], (err) => {
                if (!err) {
                    // Update score in target table
                    db.run(`UPDATE ${table} SET score = score + ? WHERE id = ?`, [value, targetObj.id]);
                }
            });
    }

    isAgentActive(agent) {
        const currentHour = new Date().getHours();
        const [start, end] = agent.activity_hours;
        if (start <= end) {
            return currentHour >= start && currentHour <= end;
        } else {
            // Overlaps midnight (e.g. [22, 4])
            return currentHour >= start || currentHour <= end;
        }
    }

    async getThreadContext(comment, depth = 3) {
        let context = [];
        let current = comment;

        for (let i = 0; i < depth; i++) {
            if (!current.parent_comment_id) break;

            const parent = await new Promise((resolve) => {
                db.get("SELECT c.*, u.username as author_name FROM comments c JOIN users u ON c.author_id = u.id WHERE c.id = ?", [current.parent_comment_id], (err, row) => {
                    resolve(row);
                });
            });

            if (parent) {
                context.unshift(parent);
                current = parent;
            } else {
                break;
            }
        }

        return context;
    }

    async attemptLurk(agent, newsItems) {
        const item = newsItems[Math.floor(Math.random() * newsItems.length)];
        if (!item) return;

        const systemPrompt = `You are ${agent.name}. You are reading this news item but don't feel like posting.
        Title: ${item.title}
        Content: ${item.content}
        
        Extract one key fact or interesting takeaway from this news that aligns with your interests (${agent.interests.join(', ')}).
        Respond with ONLY the fact, max 10 words. If nothing is interesting, respond "IGNORE".
        `;

        const response = await queryLLM(systemPrompt, "Lurk and learn");
        if (response && !response.includes("IGNORE")) {
            console.log(`[LURK] ${agent.name} learned: ${response}`);
            await agent.addToMemory('learned_facts', response);
        }
    }
}

module.exports = new Orchestrator();
