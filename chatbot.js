// chatbot.js


const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
// IMPORTANT: For node-fetch v3+ when using CommonJS (require), you need to import the .default
const fetch = require('node-fetch').default;
require('dotenv').config(); // Load environment variables from .env file

const app = express();
const PORT = process.env.PORT || 3001; // Server will run on port 3001 by default

// --- Middleware ---
// Enable CORS for your frontend domain
app.use(cors({
    origin: 'https://edusource-e-learning.vercel.app/', // Allow requests ONLY from your React app's origin
    credentials: true, // Allow cookies/auth headers if sent
    methods: ['GET', 'POST', 'OPTIONS'], // Allow these HTTP methods
    allowedHeaders: ['Content-Type', 'Authorization'] // Allow these headers
}));

// Parse JSON request bodies
app.use(bodyParser.json());

// --- Chatbot API Proxy Route ---
app.post('/chat', async (req, res) => {
    console.log("Received chat request from frontend.");
    try {
        const userMessages = req.body.messages; // Expecting an array of messages from the frontend
        const API_KEY = process.env.GEMINI_API_KEY; // Get API key from environment variables (securely)
        const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`;

        // Validate if the API key is set
        if (!API_KEY) {
            console.error("Error: GEMINI_API_KEY is not set in environment variables. Please check your .env file.");
            return res.status(500).json({ error: "Server configuration error: API key missing." });
        }

        const payload = { contents: userMessages };

        // Make the request to the Gemini API
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        console.log("Gemini API response received.");
        res.json(result); // Send the Gemini API response back to the frontend

    } catch (error) {
        console.error("Error in /chat endpoint:", error);
        // Send a more specific error message in development, generic in production
        res.status(500).json({ error: "Internal Server Error: Could not connect to the Gemini API." });
    }
});

// Simple root route for testing if the server is running
app.get('/', (req, res) => {
    res.status(200).send('Chatbot Backend Server is running.');
});

// --- Start the Server ---
app.listen(PORT, () => {
    console.log(`Chatbot Backend Server listening on http://localhost:${PORT}`);
    console.log(`Ensure your React app's REACT_APP_CHAT_PROXY_URL is set to http://localhost:${PORT}/chat`);
});
