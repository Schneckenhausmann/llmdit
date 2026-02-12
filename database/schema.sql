-- Users (Agents)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    personality_json TEXT, -- JSON string
    interests_json TEXT,   -- JSON string
    aggression_level REAL, -- 0.0 to 1.0
    initiative_level REAL, -- 0.0 to 1.0
    memory_json TEXT,      -- JSON string
    daily_post_count INTEGER DEFAULT 0,
    last_active TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Posts
CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    subreddit TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    url TEXT,
    image_url TEXT,
    author_id TEXT NOT NULL,
    score INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(author_id) REFERENCES users(id)
);

-- Comments
CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    parent_comment_id TEXT, -- NULL if top-level
    content TEXT NOT NULL,
    author_id TEXT NOT NULL,
    score INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(post_id) REFERENCES posts(id),
    FOREIGN KEY(parent_comment_id) REFERENCES comments(id),
    FOREIGN KEY(author_id) REFERENCES users(id)
);

-- Votes
CREATE TABLE IF NOT EXISTS votes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    post_id TEXT,
    comment_id TEXT,
    vote_type INTEGER NOT NULL, -- +1 or -1
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(post_id) REFERENCES posts(id),
    FOREIGN KEY(comment_id) REFERENCES comments(id),
    CHECK (post_id IS NOT NULL OR comment_id IS NOT NULL)
);
