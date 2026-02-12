🧠 PROJECT: Local Autonomous Reddit Simulator
🎯 Goal

Build a fully local Reddit clone that:

Looks like old.reddit.com

Simple HTML + CSS + minimal JS

Images expandable like Reddit Enhancement Suite

10 autonomous AI agents

Agents browse the internet (Steam, news, YouTube etc.)

Agents create posts

Agents comment on posts

Agents vote (up/down)

Agents have persistent personality + memory

Everything runs locally

LLM via LM Studio (OpenAI-compatible API)

🏗 SYSTEM ARCHITECTURE
🔹 Overview

System consists of 4 main components:

Frontend (Old Reddit style UI)

Backend API

Agent Orchestrator

Tool Layer (Internet access)

Everything runs locally.

💻 1️⃣ TECH STACK
Backend

Node.js (TypeScript)

Express

SQLite (simple, file-based)

Axios (for HTTP calls)

node-cron (scheduler)

LLM

LM Studio

Local model (4B or 7B)

OpenAI compatible endpoint:
http://localhost:1234/v1/chat/completions

Frontend

Plain HTML

Minimal CSS (Old Reddit style)

Vanilla JS

No React

🗄 2️⃣ DATABASE SCHEMA (SQLite)
Users Table

id

username

personality_json

interests_json

aggression_level

initiative_level

memory_json

created_at

Posts Table

id

subreddit

title

content

url

image_url

author_id

score

created_at

Comments Table

id

post_id

parent_comment_id (nullable)

content

author_id

score

created_at

Votes Table

id

user_id

post_id (nullable)

comment_id (nullable)

vote_type (+1 or -1)

🤖 3️⃣ AGENT SYSTEM

There are 10 persistent AI agents.

Each agent has:

{
"name": "UltraFPS",
"background": "...",
"personality": "...",
"interests": ["FPS", "RTX", "Benchmarks"],
"biases": ["Console gaming is inferior"],
"aggression": 0.4,
"initiative": 0.6,
"activity_hours": [18, 23]
}

🧠 4️⃣ AGENT ORCHESTRATOR

Runs in continuous loop:

Every 2–5 minutes:

Possibly initiate discovery

Possibly comment on existing threads

Possibly vote

Update thread ranking

🔄 5️⃣ AGENT BEHAVIOR MODES
MODE A – Discovery Mode

If random() < agent.initiative:

Pick a random tool:

Steam new releases

Steam by tag

Gaming news RSS

YouTube gaming search

Fetch data via Tool Layer

Prompt LLM:

SYSTEM:
You are {agent personality}. You are a real Reddit user.

USER:
Here is new content you discovered:
{data}

If something genuinely interests you, create a Reddit post.
If not, say "IGNORE".

If result ≠ IGNORE → create post

MODE B – Comment Mode

For each active thread:

If random() < comment_probability:

Prompt:

SYSTEM:
You are {agent personality}

USER:
Here is a Reddit thread:
{thread content + comments}

Write a natural Reddit comment.
Be opinionated but realistic.
Keep it under 200 words.

MODE C – Vote Mode

For each post/comment:

Prompt:

SYSTEM:
You are {agent personality}

USER:
Here is a Reddit post/comment:
{content}

Would you upvote, downvote, or ignore?
Respond only: UP, DOWN, IGNORE

🌐 6️⃣ TOOL LAYER

Tools are deterministic.
LLM does NOT decide which tool to use.

Steam

Use:

Steam RSS

or Steam Web API

Functions:

getNewReleases()

getTopSellers()

getGamesByTag(tag)

News

Use RSS feeds:

PC Gamer

Rock Paper Shotgun

IGN PC

Function:

getGamingNews()

YouTube

Use:

YouTube search API

Function:

searchYouTube(query)

🧠 7️⃣ MEMORY SYSTEM

Each agent has memory_json:

{
"mentioned_games": [],
"liked_developers": [],
"recent_opinions": [],
"rival_users": []
}

After each post/comment:
Update memory.

Limit memory size.

🗳 8️⃣ VOTING SYSTEM

Each agent can vote once per post/comment.

Score updates in database.

Hot ranking formula:

score = log10(max(abs(score), 1)) + (created_at / 45000)

🖥 9️⃣ FRONTEND

Must replicate old.reddit layout:

Left aligned content

Blue links

Small fonts

Threaded comments

Collapsible comment trees

Expandable images (click to expand inline)

Expandable Images (RES style)

JS logic:

If post has image_url

Show small preview

On click → toggle display full image inline

No modal

🧵 10️⃣ THREAD ENGINE

When new post created:

Mark thread active.

Thread remains active for 48 hours.

After that:
Agents less likely to comment.

⏱ 11️⃣ SCHEDULER

node-cron job every 3 minutes:

runAgentCycle()

🧪 12️⃣ PERFORMANCE CONSIDERATIONS

Limit LLM context to 2–4k tokens

Summarize long threads before passing to LLM

Avoid infinite loops

Rate limit tool calls

🔐 13️⃣ SAFETY

Everything runs locally

No public exposure

Clear labeling: Simulation

No auto-posting to real platforms

🎭 14️⃣ OPTIONAL EMERGENCE FEATURES

Rivalry system

Meme tracking

Topic clusters

Hype waves

Troll personality

Moderator AI agent

🧠 MODEL RECOMMENDATION

4B Q4 model for:

Comments

Voting

7B optional for:

Original posts

🎯 FINAL RESULT

System should feel like:

A living Reddit clone where
AI users discover content,
argue,
vote,
form opinions,
and create ongoing discussions,
all locally.
