const db = require('../database/db');

class Agent {
    constructor(data) {
        this.id = null; // Will be set after loading/creating
        this.name = data.name;
        this.age = data.age;
        this.occupation = data.occupation;
        this.politics = data.politics;
        this.personality = data.personality;
        this.modifier = data.modifier;
        this.quirk = data.quirk;
        this.interests = data.interests;
        this.aggression = data.aggression;
        this.initiative = data.initiative;
        this.biases = data.biases || [];
        this.iq = data.iq || 'average';
        this.memory = {
            mentioned_games: [],
            liked_developers: [],
            learned_facts: [],
            relationships: {}, // key: agent_name, value: {sentiment: number, last_interaction: string}
            recent_opinions: []
        };
        this.daily_post_count = 0;
        this.last_active = null;
    }

    // Load agent from DB or create if not exists
    async init() {
        return new Promise((resolve, reject) => {
            db.get("SELECT * FROM users WHERE username = ?", [this.name], (err, row) => {
                if (err) return reject(err);

                if (row) {
                    this.id = row.id;
                    this.memory = JSON.parse(row.memory_json || '{}');
                    this.daily_post_count = row.daily_post_count;
                    this.last_active = row.last_active;
                    resolve(this);
                } else {
                    this.create().then(resolve).catch(reject);
                }
            });
        });
    }

    async create() {
        return new Promise((resolve, reject) => {
            const id = require('crypto').randomUUID();
            const memoryJson = JSON.stringify(this.memory);
            const interestsJson = JSON.stringify(this.interests);
            const personalityJson = JSON.stringify({
                description: this.personality,
                biases: this.biases
            });

            const query = `INSERT INTO users (id, username, personality_json, interests_json, aggression_level, initiative_level, memory_json) VALUES (?, ?, ?, ?, ?, ?, ?)`;

            db.run(query, [id, this.name, personalityJson, interestsJson, this.aggression, this.initiative, memoryJson], (err) => {
                if (err) return reject(err);
                this.id = id;
                resolve(this);
            });
        });
    }

    async save() {
        return new Promise((resolve, reject) => {
            const memoryJson = JSON.stringify(this.memory);
            const personalityJson = JSON.stringify({
                description: this.personality,
                biases: this.biases
            });

            const query = `UPDATE users SET memory_json = ?, personality_json = ?, daily_post_count = ?, last_active = ? WHERE id = ?`;
            db.run(query, [memoryJson, personalityJson, this.daily_post_count, new Date().toISOString(), this.id], (err) => {
                if (err) return reject(err);
                resolve();
            });
        });
    }

    async addToMemory(key, value) {
        if (!this.memory[key]) this.memory[key] = [];
        this.memory[key].push(value);
        if (this.memory[key].length > 50) {
            this.memory[key].shift();
        }
        await this.save();
    }

    async evolve(queryLLM) {
        if (!this.memory.recent_opinions) this.memory.recent_opinions = [];
        const recentOpinions = this.memory.recent_opinions.slice(-5).join('; ');
        if (!recentOpinions) return;

        const systemPrompt = `You are an AI character named ${this.name}.
        Current Personality: ${this.personality}
        Current Biases: ${this.biases.join(', ')}
        
        You have recently formed these opinions based on what you read:
        "${recentOpinions}"
        
        Based on these new experiences, how should your personality or biases slightly evolve? 
        Be subtle. Do not completely change who you are, just shift your perspective.
        
        Format your response EXACTLY as JSON:
        {
            "personality": "Updated personality description",
            "biases": ["Updated bias 1", "Updated bias 2", ...]
        }
        `;

        const response = await queryLLM(systemPrompt, "Evolve your character.");
        if (!response) return;

        try {
            const jsonStr = response.replace(/```json/g, '').replace(/```/g, '').trim();
            const update = JSON.parse(jsonStr);

            if (update.personality && Array.isArray(update.biases)) {
                console.log(`[EVOLUTION] ${this.name} is evolving...`);
                console.log(`Old: ${this.personality}`);
                console.log(`New: ${update.personality}`);

                this.personality = update.personality;
                this.biases = update.biases;
                await this.save();
            }
        } catch (e) {
            console.error(`[EVOLUTION] Failed to parse evolution response for ${this.name}:`, e.message);
        }
    }
}

module.exports = Agent;
