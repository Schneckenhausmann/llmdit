const express = require('express');
const path = require('path');
const app = express();
const port = 3000;
const apiRoutes = require('./routes/api');

const cron = require('node-cron');
const orchestrator = require('./agents/orchestrator');

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api', apiRoutes);

// Serve main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Settings Endpoint
app.post('/api/settings/speed', (req, res) => {
    const { speed } = req.body;
    if (['paused', 'slow', 'normal', 'fast', 'turbo'].includes(speed)) {
        orchestrator.setSpeed(speed);
        res.json({ success: true, speed });
    } else {
        res.status(400).json({ error: 'Invalid speed' });
    }
});

// Start server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    // Initialize agents on startup
    orchestrator.init().then(() => {
        console.log("Orchestrator initialized.");
        // Initial run
        orchestrator.runCycle();
    });
});
