const axios = require('axios');

const LM_STUDIO_URL = 'http://localhost:1234/v1/chat/completions';

async function queryLLM(systemPrompt, userPrompt) {
    console.log(`[LLM] Querying...`);
    try {
        const response = await axios.post(LM_STUDIO_URL, {
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0.7,
            max_tokens: 500,
            model: '' // Empty string often works better for "current loaded model" in LM Studio
        });

        const content = response.data.choices[0]?.message?.content;
        if (content === undefined || content === null) {
            console.error('[LLM] Received empty or invalid response structure:', JSON.stringify(response.data));
            return null;
        }

        console.log(`[LLM] Success. Length: ${content.length}`);
        return content;
    } catch (error) {
        if (error.code === 'ECONNREFUSED') {
            console.error('[LLM] Connection refused! Is LM Studio running on port 1234?');
            // Return null or mock if dev mode
            return null;
        }
        console.error('[LLM] Error:', error.message);
        return null;
    }
}

module.exports = { queryLLM };
