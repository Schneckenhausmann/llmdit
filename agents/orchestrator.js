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

        // 1. Fetch external content (Discovery Phase)
        const newsItems = await fetchNews();
        console.log(`Fetched ${newsItems.length} news items.`);

        // 2. Shuffle agents to randomize order
        const shuffledAgents = [...this.agents].sort(() => 0.5 - Math.random());

        for (const agent of shuffledAgents) {
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
        if (agent.daily_post_count < 3 && Math.random() < agent.initiative * 0.5) {
            const subject = newsItems[Math.floor(Math.random() * newsItems.length)];
            if (subject) {
                await this.attemptPost(agent, subject);
            }
        }

        // --- COMMENT MODE ---
        // 50% chance to look at posts, 50% chance to look at comments to reply to
        if (Math.random() < 0.5) {
            const posts = await this.getRecentPosts();
            for (const post of posts) {
                if (Math.random() < 0.3) {
                    await this.attemptComment(agent, post); // Top level comment
                }
                if (Math.random() < 0.5) {
                    await this.attemptVote(agent, post, 'post');
                }
            }
        } else {
            // Reply to comments
            const comments = await this.getRecentComments();
            for (const comment of comments) {
                // Check depth
                const depth = await this.getCommentDepth(comment.id);
                if (depth < 5 && Math.random() < 0.3) {
                    await this.attemptReplyToComment(agent, comment);
                }
                if (Math.random() < 0.5) {
                    await this.attemptVote(agent, comment, 'comment');
                }
            }
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
        // DUPLICATION CHECK
        const existingPost = await this.getPostByUrl(newsItem.link);
        if (existingPost) {
            console.log(`${agent.name} found existing post for ${newsItem.link}, checking if they want to comment...`);
            await this.attemptComment(agent, existingPost, "You found this link but noticed it was already posted. You want to discuss it.");
            return;
        }

        const antiAIList = "furthermore, moreover, unlock, leverage, tapestry, navigate, nuanced, delving, in conclusion, fundamentally, underscore, multifaceted";

        const systemPrompt = `You are ${agent.name}. 
        CORE PERSONA: ${agent.personality}
        COMMUNICATION STYLE: ${agent.modifier}
        QUIRK: ${agent.quirk}
        BIASES: ${agent.biases.join(', ')}
        INTERESTS: ${agent.interests.join(', ')}

        You found this online:
        Title: ${newsItem.title}
        Content: ${newsItem.content}
        Source: ${newsItem.source}

        Decide if you want to post this to Reddit.
        If NO, respond "IGNORE".
        If YES, write a Title and Body.

        INSTRUCTIONS:
        - ACT HUMAN. You are a bored/hype internet user.
        - NO AI-isms. BANNED WORDS: ${antiAIList}.
        - OPINIONATED: Why are you posting this? Give a biased take.
        - STRATEGIC IMPERFECTION: Use "tbh", "ngl", or "Wait...".
        - Length: Body should be 1-3 short sentences.
        
        Format:
        TITLE: <title>
        BODY: <body>
        `;

        const response = await queryLLM(systemPrompt, "Do you want to post this?");
        if (!response || response.trim().startsWith('IGNORE')) return;

        const titleMatch = response.match(/TITLE:\s*(.+)/);
        const bodyMatch = response.match(/BODY:\s*([\s\S]+)/);

        if (titleMatch && bodyMatch) {
            const title = titleMatch[1].trim();
            const body = bodyMatch[1].trim();
            const subreddit = "r/gaming"; // Default for now

            await this.createPost(agent, subreddit, title, body, newsItem.link, newsItem.image);
            agent.daily_post_count++;
            await agent.save();
            console.log(`${agent.name} posted: ${title}`);
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
        const antiAIList = "furthermore, moreover, unlock, leverage, tapestry, navigate, nuanced, delving, in conclusion, fundamentally, underscore, multifaceted";

        // Fetch author info for social memory
        const author = await this.getAgentById(post.author_id);
        let socialContext = "";
        if (author && author.name !== agent.name) {
            const rel = agent.memory.relationships[author.name];
            if (rel) {
                socialContext = `SOCIAL MEMORY: You ${rel.sentiment > 0 ? 'like' : 'dislike'} ${author.name}. Sentiment score: ${rel.sentiment}. Last interaction was "${rel.last_interaction}".`;
            }
        }

        const coreInstructions = `
        - ACT HUMAN. You are a real person on Reddit.
        - NO AI-isms. BANNED WORDS: ${antiAIList}.
        - STRATEGIC IMPERFECTION: Use "I think...", "Wait, actually...", or "tbh". Mix sentence lengths. Don't be too polished.
        - OPINIONATED: Pick a side. Be biased. Don't be a helpful assistant.
        - SOCIAL: ${socialContext} If you like them, be supportive. If you dislike them, be snarky or critical.
        - FORMATTING: Use **bold** for emphasis. Lowercase/slang is fine if it fits.
        `;

        if (agent.iq === 'high') {
            systemPrompt = `You are ${agent.name} (Age ${agent.age}, ${agent.occupation}). 
             CORE PERSONA: ${agent.personality}
             STYLE: ${agent.modifier}
             QUIRK: ${agent.quirk}
             POLITICS: ${agent.politics}
             BIASES: ${agent.biases.join(', ')}

             Post: "${post.title}"
             Body: "${post.content}"
             ${extraContext}

             Write a SOPHISTICATED, ANALYTICAL comment. 
             - Length: 3-5 sentences. A solid paragraph.
             ${coreInstructions}
             `;
        } else {
            systemPrompt = `You are ${agent.name} (Age ${agent.age}, ${agent.occupation}). 
             CORE PERSONA: ${agent.personality}
             STYLE: ${agent.modifier}
             QUIRK: ${agent.quirk}
             POLITICS: ${agent.politics}
             BIASES: ${agent.biases.join(', ')}

             Post: "${post.title}"
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
        const antiAIList = "furthermore, moreover, unlock, leverage, tapestry, navigate, nuanced, delving, in conclusion, fundamentally, underscore, multifaceted";

        const author = await this.getAgentById(targetComment.author_id);
        let socialContext = "";
        if (author && author.name !== agent.name) {
            const rel = agent.memory.relationships[author.name];
            if (rel) {
                socialContext = `SOCIAL MEMORY: You ${rel.sentiment > 0 ? 'like' : 'dislike'} ${author.name}. Sentiment score: ${rel.sentiment}.`;
            }
        }

        const coreInstructions = `
        - TALK BACK. React to their point specifically.
        - SOCIAL: ${socialContext} Treat them based on how you feel about them.
        - NO AI-isms. BANNED WORDS: ${antiAIList}.
        - IMPERFECTION: Use contractions (don't, can't) and varied rhythm.
        - QUIRK: Work in your quirk ("${agent.quirk}") if it's remotely possible.
        `;

        if (agent.iq === 'high') {
            systemPrompt = `You are ${agent.name} (Age ${agent.age}, ${agent.occupation}). 
             PERSONA: ${agent.personality} | STYLE: ${agent.modifier}
             
             Comment to reply to: "${targetComment.content}"
             
             Write a SOPHISTICATED, LENGTHY reply.
             - Length: 2-4 sentences.
             ${coreInstructions}
             `;
        } else {
            systemPrompt = `You are ${agent.name} (Age ${agent.age}, ${agent.occupation}). 
             PERSONA: ${agent.personality} | STYLE: ${agent.modifier}
             
             Comment to reply to: "${targetComment.content}"
             
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
        Respond with exactly one word: UPVOTE, DOWNVOTE, or IGNORE.
        `;

        const response = await queryLLM(systemPrompt, "Vote?");
        if (!response) return;

        const decision = response.trim().toUpperCase();
        let vote = 0;

        if (decision.includes('UPVOTE')) vote = 1;
        else if (decision.includes('DOWNVOTE')) vote = -1;
        else return; // Ignore

        const col = type === 'post' ? 'post_id' : 'comment_id';
        const id = require('crypto').randomUUID();

        db.run(`INSERT INTO votes (id, user_id, ${col}, vote_type) VALUES (?, ?, ?, ?)`,
            [id, agent.id, targetObj.id, vote], (err) => {
                if (!err) {
                    const table = type === 'post' ? 'posts' : 'comments';
                    db.run(`UPDATE ${table} SET score = score + ? WHERE id = ?`, [vote, targetObj.id]);
                }
            });
    }
}

module.exports = new Orchestrator();
