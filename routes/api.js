const express = require('express');
const router = express.Router();
const db = require('../database/db');

// Get all posts
router.get('/posts', (req, res) => {
    const sort = req.query.sort || 'hot';
    let orderBy = 'posts.score DESC'; // Default hot

    if (sort === 'new') {
        orderBy = 'posts.created_at DESC';
    } else if (sort === 'rising') {
        // Rising could be recent posts with high activity, or just comment count for simplicity properties
        // Let's use comment count + recentness or just comment count for now
        orderBy = 'comment_count DESC, posts.created_at DESC';
    }

    const query = `
        SELECT posts.*, users.username, users.personality_json,
        (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id) as comment_count
        FROM posts
        JOIN users ON posts.author_id = users.id
        ORDER BY ${orderBy}
        LIMIT 50
    `;
    db.all(query, [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ posts: rows });
    });
});

// Get a single post
router.get('/posts/:id', (req, res) => {
    const query = `
        SELECT posts.*, users.username,
        (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id) as comment_count
        FROM posts
        JOIN users ON posts.author_id = users.id
        WHERE posts.id = ?
    `;
    db.get(query, [req.params.id], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (!row) {
            res.status(404).json({ error: 'Post not found' });
            return;
        }
        res.json({ post: row });
    });
});

// Get comments for a post
router.get('/posts/:id/comments', (req, res) => {
    const query = `
        SELECT comments.*, users.username
        FROM comments
        JOIN users ON comments.author_id = users.id
        WHERE comments.post_id = ?
        ORDER BY comments.created_at ASC
    `;
    db.all(query, [req.params.id], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ comments: rows });
    });
});

// Create a new post
router.post('/posts', (req, res) => {
    const { title, content, subreddit } = req.body;
    const crypto = require('crypto');
    const id = crypto.randomUUID();

    // For user submitted posts, we'll create a special "Human" user or just use a placeholder ID if foreign key allows.
    // We should probably check if a "Human" user exists or create one.
    // For simplicity, let's create/use a fixed "human_user" ID.
    const authorId = 'human_user';
    const authorName = 'You';

    // Ensure human user exists
    db.run(`INSERT OR IGNORE INTO users (id, username, personality_json, interests_json, aggression_level, initiative_level, memory_json) 
            VALUES (?, ?, '{}', '[]', 0.5, 0.5, '{}')`,
        [authorId, authorName], (err) => {
            if (err) console.error("Error creating human user:", err);

            // Now insert post
            db.run(`INSERT INTO posts (id, subreddit, title, content, author_id) VALUES (?, ?, ?, ?, ?)`,
                [id, subreddit || 'r/all', title, content, authorId], (err) => {
                    if (err) {
                        res.status(500).json({ error: err.message });
                        return;
                    }
                    res.json({ success: true, id: id });
                });
        });
});

module.exports = router;
