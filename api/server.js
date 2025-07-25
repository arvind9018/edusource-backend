// server.js
// Install dependencies: npm install express body-parser cors node-fetch dotenv

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
// IMPORTANT: Use dynamic import for node-fetch v3+
let fetch; // Declare fetch here

require('dotenv').config(); // Required for loading environment variables like GEMINI_API_KEY

const app = express();
const PORT = process.env.PORT || 3001; // Server will run on port 3001 by default

// --- Middleware ---
// Parse JSON request bodies for all incoming requests
app.use(bodyParser.json());

// Configure CORS for your frontend domain
app.use(cors({
    origin: 'http://localhost:3000', // Allow requests ONLY from your React app's origin
    credentials: true, // Allow cookies/auth headers if sent
    methods: ['GET', 'POST', 'OPTIONS'], // Allow these HTTP methods
    allowedHeaders: ['Content-Type', 'Authorization'] // Allow these headers
}));

// --- Razorpay API Handler (Imported) ---
// Ensure 'razorpay.js' exists in the same directory as this server.js file
// and exports a function that takes (req, res) as arguments.
const razorpayApiHandler = require('./razorpay');

// --- Routes ---

// 1. Razorpay API Proxy Route
// This route will forward incoming requests to your razorpay.js handler
app.all('/api/razorpay', async (req, res) => {
    console.log("Received request for /api/razorpay");
    await razorpayApiHandler(req, res);
});

// 2. Gemini Chatbot API Proxy Route
app.post('/chat', async (req, res) => {
    console.log("Received chat request from frontend.");
    try {
        // Dynamically import node-fetch if it hasn't been imported yet
        if (!fetch) {
            fetch = (await import('node-fetch')).default;
        }

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
        res.status(500).json({ error: "Internal Server Error: Could not connect to the Gemini API." });
    }
});

// Simple root route for testing if the server is running
app.get('/', (req, res) => {
    res.status(200).send('Combined Backend Server is running.');
});

// --- Start the Server ---
app.listen(PORT, () => {
    console.log(`Combined Backend Server listening on http://localhost:${PORT}`);
    console.log(`For Chatbot: Ensure your React app's REACT_APP_CHAT_PROXY_URL is set to http://localhost:${PORT}/chat`);
    console.log(`For Razorpay: Ensure your React app's RAZORPAY_BACKEND_ENDPOINT is set to http://localhost:${PORT}/api/razorpay`);
});
