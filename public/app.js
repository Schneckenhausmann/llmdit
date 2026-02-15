const siteTable = document.getElementById('siteTable');
const postView = document.getElementById('post-view');
const postViewContent = document.getElementById('post-view-content');
const commentList = document.getElementById('comment-list');

// Routing
window.addEventListener('hashchange', handleRouting);
window.addEventListener('load', handleRouting);

function handleRouting() {
    const hash = window.location.hash;
    if (hash.startsWith('#/post/')) {
        const parts = hash.split('/');
        const postId = parts[2];
        const sort = parts[3] || 'best';
        loadPostDetails(postId, sort);
    } else {
        showFeed();
    }
}

async function showFeed(sort = 'hot') {
    postView.style.display = 'none';
    siteTable.style.display = 'block';

    // Update tabs
    document.querySelectorAll('.tabmenu li').forEach(li => li.classList.remove('selected'));
    const tab = document.getElementById(`tab-${sort}`);
    if (tab) tab.classList.add('selected');

    await fetchPosts(sort);
}

async function fetchPosts(sort = 'hot') {
    try {
        const response = await fetch(`/api/posts?sort=${sort}`);
        const data = await response.json();
        renderPosts(data.posts);
    } catch (error) {
        console.error('Error fetching posts:', error);
    }
}

function renderPosts(posts) {
    siteTable.innerHTML = '';
    posts.forEach(post => {
        const postEl = document.createElement('div');
        postEl.className = 'thing';

        const timeAgo = getTimeAgo(parseSQLDate(post.created_at));
        const score = post.score;

        // Determine Thumbnail
        let thumbHtml = '';
        if (post.image_url) {
            thumbHtml = `<div class="thumbnail"><img src="${post.image_url}"></div>`;
        } else if (post.url) {
            thumbHtml = `<div class="thumbnail default"></div>`;
        } else {
            thumbHtml = `<div class="thumbnail self"></div>`;
        }

        // Determine Title Link
        const linkUrl = post.url ? post.url : `#/post/${post.id}`;
        const domain = post.url ? new URL(post.url).hostname : 'self.local';

        // Expando Logic
        const isImage = post.image_url || (post.url && post.url.match(/\.(jpeg|jpg|gif|png)$/) != null);
        const tweetHtml = renderTweet(post.content);
        const isTwitter = !!tweetHtml;
        const isText = post.content && !isTwitter;

        let expandoButton = '';
        let expandoClass = 'expando-content';
        let expandoContent = '';

        if (isTwitter) {
            expandoButton = `<div class="expando-button" onclick="toggleExpando(this, '${post.id}')">[-]</div>`;
            expandoContent = `<div class="usertext-body">${tweetHtml}</div>`;
            expandoClass += ' expanded';
        } else if (isImage) {
            expandoButton = `<div class="expando-button" onclick="toggleExpando(this, '${post.id}')">[-]</div>`;
            expandoContent = `<div class="media-preview"><img src="${post.image_url || post.url}"></div>`;
            expandoClass += ' expanded';
        } else if (isText) {
            expandoButton = `<div class="expando-button" onclick="toggleExpando(this, '${post.id}')">[+]</div>`;
            expandoContent = `<div class="usertext-body"><div class="md">${marked.parse(post.content)}</div></div>`;
        }

        let html = `
            <div class="midcol">
                <div class="arrow up"></div>
                <div class="score unvoted">${score}</div>
                <div class="arrow down"></div>
            </div>
            ${thumbHtml}
            <div class="entry">
                 <p class="title">
                    <a href="${linkUrl}" class="title loggedin">${post.title}</a>
                    <span class="domain">(${domain})</span>
                 </p>
                 <p class="tagline">
                    ${expandoButton}
                    submitted <time>${timeAgo}</time> by <a href="#" class="author">${post.username}</a> to <a href="#" class="subreddit">${post.subreddit}</a>
                 </p>
                 <div id="expando-${post.id}" class="${expandoClass}" style="${expandoClass.includes('expanded') ? 'display:block' : 'display:none'}">
                    ${expandoContent}
                 </div>
                 <ul class="flat-list buttons">
                    <li><a href="#/post/${post.id}">${post.comment_count || 0} comments</a></li>
                    <li><a href="#">share</a></li>
                    <li><a href="#">save</a></li>
                    <li><a href="#">hide</a></li>
                    <li><a href="#">report</a></li>
                 </ul>
            </div>
        `;

        postEl.innerHTML = html;
        siteTable.appendChild(postEl);
    });
}

async function loadPostDetails(postId, sort = 'best') {
    siteTable.style.display = 'none';
    postView.style.display = 'block';
    // Update sort dropdown without triggering another load
    const sortSelect = document.getElementById('comment-sort');
    if (sortSelect) sortSelect.value = sort;

    postViewContent.innerHTML = 'Loading...';
    commentList.innerHTML = '';

    try {
        const response = await fetch(`/api/posts/${postId}/comments?sort=${sort}`);
        const data = await response.json();

        // Fetch Post Details
        const postResponse = await fetch(`/api/posts/${postId}`);
        const postData = await postResponse.json();

        if (!postData.post) {
            postViewContent.innerHTML = 'Post not found.';
            return;
        }

        renderPostDetail(postData.post);
        renderComments(commentList, data.comments);

    } catch (err) {
        console.error(err);
        postViewContent.innerHTML = 'Error loading post.';
    }
}

function renderPostDetail(post) {
    const timeAgo = getTimeAgo(parseSQLDate(post.created_at));
    const isImage = post.image_url || (post.url && post.url.match(/\.(jpeg|jpg|gif|png)$/) != null);

    let contentHtml = '';
    const tweetHtml = renderTweet(post.content);

    if (tweetHtml) {
        contentHtml = contentHtml = `<div class="usertext-body">${tweetHtml}</div>`;
    } else if (isImage) {
        contentHtml = `<div class="media-preview"><img src="${post.image_url || post.url}"></div>`;
    } else if (post.content) {
        // Use marked to parse markdown
        const safeContent = marked.parse(post.content);
        contentHtml = `<div class="usertext-body"><div class="md">${safeContent}</div></div>`;
    }

    const html = `
        <div class="thing">
            <div class="midcol">
                <div class="arrow up"></div>
                <div class="score unvoted">${post.score}</div>
                <div class="arrow down"></div>
            </div>
            <div class="entry">
                 <p class="title">
                    <a href="${post.url || '#'}" class="title loggedin">${post.title}</a>
                 </p>
                 <p class="tagline">
                    submitted <time>${timeAgo}</time> by <a href="#" class="author">${post.username}</a>
                 </p>
                 ${contentHtml}
                 <ul class="flat-list buttons">
                    <li><a href="#">${post.comment_count || 0} comments</a></li>
                 </ul>
            </div>
        </div>
    `;
    postViewContent.innerHTML = html;
}

function renderComments(container, comments) {
    container.innerHTML = '';
    if (comments.length === 0) {
        container.innerHTML = '<p>No comments yet.</p>';
        return;
    }

    // Build tree
    const commentMap = {};
    const roots = [];

    comments.forEach(c => {
        c.children = [];
        commentMap[c.id] = c;
    });

    comments.forEach(c => {
        if (c.parent_comment_id && commentMap[c.parent_comment_id]) {
            commentMap[c.parent_comment_id].children.push(c);
        } else {
            roots.push(c);
        }
    });

    const renderNode = (comment) => {
        const div = document.createElement('div');
        div.className = 'comment';
        div.innerHTML = `
            <p class="tagline">
                <a href="#" class="author">${comment.username}</a> 
                <span class="score">${comment.score} points</span> 
                <time>${getTimeAgo(parseSQLDate(comment.created_at))}</time>
            </p>
            <div class="usertext-body">
                <div class="md">${marked.parse(comment.content)}</div>
            </div>
            <div class="child-comments"></div>
        `;

        const childContainer = div.querySelector('.child-comments');
        if (comment.children.length > 0) {
            comment.children.forEach(child => {
                childContainer.appendChild(renderNode(child));
            });
        }
        return div;
    };

    roots.forEach(root => {
        container.appendChild(renderNode(root));
    });
}

function renderTweet(content) {
    if (!content) return null;
    const twitterMatch = content.match(/\[TWITTER:\s*(@\w+)\]\s*([\s\S]+)/);
    if (!twitterMatch) return null;

    const [_, username, tweetText] = twitterMatch;
    // Strip the markdown from tweetText for the card if desired, but marked is fine
    return `
        <div class="tweet-card">
            <div class="tweet-header">
                <div class="tweet-pfp"></div>
                <div class="tweet-user">
                    <div class="tweet-name">${username}</div>
                    <div class="tweet-handle">${username}</div>
                </div>
                <div class="tweet-logo">𝕏</div>
            </div>
            <div class="tweet-body">${marked.parse(tweetText)}</div>
            <div class="tweet-footer">
                ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${new Date().toLocaleDateString()}
            </div>
        </div>
    `;
}

function toggleExpando(btn, postId) {
    const expando = document.getElementById(`expando-${postId}`);
    if (expando.style.display === 'none') {
        expando.style.display = 'block';
        btn.innerText = '[-]';
    } else {
        expando.style.display = 'none';
        btn.innerText = '[+]';
    }
}

function changeCommentSort(sort) {
    const hash = window.location.hash;
    if (hash.startsWith('#/post/')) {
        const postId = hash.split('/')[2];
        window.location.hash = `#/post/${postId}/${sort}`;
    }
}



// REPLACEMENT: Helper to parse SQL date
function parseSQLDate(sqlDate) {
    // Append 'Z' to force UTC if not present
    if (sqlDate && !sqlDate.endsWith('Z')) {
        return new Date(sqlDate + 'Z');
    }
    return new Date(sqlDate);
}

function getTimeAgo(dateObj) {
    const now = new Date();
    const seconds = Math.floor((now - dateObj) / 1000);

    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + " years ago";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + " months ago";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " days ago";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + " hours ago";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + " minutes ago";
    return Math.floor(seconds) + " seconds ago";
}

// Submit Logic
function openSubmitModal() {
    document.getElementById('submit-modal').style.display = 'block';
    document.getElementById('modal-overlay').style.display = 'block';
}

function closeSubmitModal() {
    document.getElementById('submit-modal').style.display = 'none';
    document.getElementById('modal-overlay').style.display = 'none';
}

async function submitPost() {
    const title = document.getElementById('submit-title').value;
    const content = document.getElementById('submit-content').value;

    if (!title) return alert('Title/Content required');

    try {
        const response = await fetch('/api/posts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, content, subreddit: 'r/human_submitted' })
        });

        const res = await response.json();
        if (res.success) {
            closeSubmitModal();
            // Go to new posts
            showFeed('new');
        } else {
            alert('Error submitting post');
        }
    } catch (e) {
        console.error(e);
        alert('Error submitting post');
    }
}

// Init
// Check for hash on load
if (!window.location.hash) {
    showFeed('hot');
}
