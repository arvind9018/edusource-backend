require('dotenv').config(); // Ensure dotenv is loaded at the very top for local testing

const Razorpay = require('razorpay');
const admin = require('firebase-admin');
const crypto = require('crypto');

// Log environment variables at startup for debugging
console.log("\n--- Backend Environment Check ---");
console.log("RAZORPAY_KEY_ID:", process.env.RAZORPAY_KEY_ID ? "Loaded" : "NOT LOADED");
console.log("RAZORPAY_KEY_SECRET:", process.env.RAZORPAY_KEY_SECRET ? "Loaded" : "NOT LOADED");
console.log("FIREBASE_SERVICE_ACCOUNT_KEY_BASE64:", process.env.FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 ? "Loaded" : "NOT LOADED");
console.log("---------------------------------\n");

// Initialize Firebase Admin SDK (IMPORTANT: Secure this properly!)
if (!admin.apps.length) {
    try {
        const firebaseServiceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_BASE64;

        if (!firebaseServiceAccountBase64) {
            throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 environment variable is not set.");
        }

        const serviceAccountJsonString = Buffer.from(firebaseServiceAccountBase64, 'base64').toString('ascii');
        const serviceAccount = JSON.parse(serviceAccountJsonString);

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            // You might need to set 'databaseURL' if your Firestore rules rely on it
            // For most modern Firestore uses, it's not strictly necessary for basic operations.
            // databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
        });
        console.log("Firebase Admin SDK initialized successfully.");
    } catch (error) {
        console.error("Firebase Admin SDK initialization error:", error);
        console.error("Ensure FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 is correctly set and is a valid Base64 encoded JSON string.");
        // Re-throw or exit process in a real server if this is critical
        // For serverless functions, this error would typically be caught by the platform's runtime.
    }
}

const db = admin.firestore();

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

// Ensure Razorpay instance is only created if keys are present
let instance;
try {
    if (RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET) {
        instance = new Razorpay({
            key_id: RAZORPAY_KEY_ID,
            key_secret: RAZORPAY_KEY_SECRET,
        });
    } else {
        throw new Error("Razorpay API keys are not loaded.");
    }
} catch (error) {
    console.error("Razorpay instance initialization error:", error);
    // Continue without instance, but actions requiring it will fail.
}


module.exports = async (req, res) => {
    // Set CORS headers for all responses (important for local development and specific origins)
    // For production, replace 'http://localhost:3000' with your actual frontend domain
    // Or, for broader access (less secure for sensitive APIs), use '*'
    res.setHeader('Access-Control-Allow-Origin', 'https://edusource-e-learning.vercel.app/');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); // Authorization for Bearer token
    res.setHeader('Access-Control-Allow-Credentials', 'true'); // If you are sending cookies/auth headers

    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Basic check for Razorpay keys before proceeding with payment logic
    if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET || !instance) {
        console.error("Razorpay keys or instance not fully configured. Cannot process payments.");
        return res.status(500).json({ success: false, error: "Payment backend not fully configured." });
    }

    // Ensure request body is parsed for POST requests
    if (req.method === 'POST' && typeof req.body !== 'object') {
        console.error("Request body is not an object. Potential parsing issue.");
        return res.status(400).json({ success: false, error: "Invalid request body format." });
    }

    if (req.method === 'POST') {
        const { action } = req.body; // 'create_order' or 'verify_payment'
        console.log(`Received POST request with action: ${action}`);

        if (action === 'create_order') {
            const { amount, currency, courseId, userId } = req.body;

            // Basic validation
            if (!amount || !currency || !courseId || !userId) {
                console.error("Missing required details for order creation:", { amount, currency, courseId, userId });
                return res.status(400).json({ success: false, error: "Missing required details for order creation." });
            }
            if (amount < 100) {
                console.error("Amount too low:", amount);
                return res.status(400).json({ success: false, error: "Amount must be at least ₹1 (100 paisa)." });
            }

            try {
                // FIXED LINE: Using a shorter, valid receipt format to avoid the 40-character limit
                const receiptId = `rcpt_${Date.now()}`;
                console.log(`Creating order with receipt: ${receiptId}`);

                const order = await instance.orders.create({
                    amount: amount, // amount in paisa
                    currency: currency,
                    receipt: receiptId,
                    notes: { courseId, userId },
                });
                console.log('Razorpay Order created successfully:', order.id);
                return res.status(200).json({ success: true, orderId: order.id, amount: order.amount, currency: order.currency });
            } catch (error) {
                console.error('Error creating Razorpay order:', error);
                const razorpayError = error.error || {};
                return res.status(500).json({
                    success: false,
                    error: "Failed to create Razorpay order.",
                    details: razorpayError.description || error.message,
                    code: razorpayError.code
                });
            }

        } else if (action === 'verify_payment') {
            const { razorpay_payment_id, razorpay_order_id, razorpay_signature, courseId, courseTitle, userId } = req.body;
            console.log("Attempting payment verification for:", { razorpay_payment_id, razorpay_order_id, courseId, userId });

            if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature || !courseId || !courseTitle || !userId) {
                console.error("Missing payment verification details:", { razorpay_payment_id, razorpay_order_id, razorpay_signature, courseId, courseTitle, userId });
                return res.status(400).json({ success: false, message: "Missing payment verification details." });
            }

            try {
                const hmac = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET);
                hmac.update(razorpay_order_id + '|' + razorpay_payment_id);
                const generatedSignature = hmac.digest('hex');

                if (generatedSignature !== razorpay_signature) {
                    console.warn("Payment signature verification failed for order:", razorpay_order_id);
                    return res.status(400).json({ success: false, message: "Payment signature verification failed." });
                }

                console.log("Payment signature verified. Proceeding with Firestore update.");
                // --- Payment is Verified: Now update Firestore ---
                const courseRef = db.collection('courses').doc(courseId);
                const courseSnap = await courseRef.get();

                if (!courseSnap.exists) {
                    console.error("Course not found for enrollment during verification:", courseId);
                    return res.status(404).json({ success: false, message: "Course not found for enrollment." });
                }

                const courseData = courseSnap.data();
                const enrolledUsers = courseData.enrolledUsers || [];

                if (enrolledUsers.includes(userId)) {
                    console.warn(`User ${userId} already enrolled in course ${courseId}.`);
                    return res.status(200).json({ success: true, status: 'already_enrolled', message: 'You are already enrolled in this course.' });
                }

                // Add user to enrolledUsers array
                await courseRef.update({
                    enrolledUsers: admin.firestore.FieldValue.arrayUnion(userId)
                });

                // Create an enrollment record (optional but recommended for auditing)
                await db.collection('enrollments').add({
                    userId: userId,
                    courseId: courseId,
                    courseTitle: courseTitle,
                    paymentId: razorpay_payment_id,
                    orderId: razorpay_order_id,
                    amount: courseData.price,
                    currency: 'INR', // Assuming paid courses are INR
                    enrollmentType: 'Paid',
                    enrolledAt: admin.firestore.FieldValue.serverTimestamp(),
                    status: 'completed'
                });

                console.log(`User ${userId} successfully enrolled in course ${courseId} via paid payment. Payment ID: ${razorpay_payment_id}`);
                return res.status(200).json({ success: true, status: 'success', message: 'Payment successful and course enrolled!' });

            } catch (error) {
                console.error('Error during payment verification or enrollment:', error);
                return res.status(500).json({ success: false, message: "Internal server error during verification.", details: error.message });
            }
        } else {
            console.warn(`Invalid action specified: ${action}`);
            return res.status(400).json({ success: false, error: "Invalid action specified." });
        }
    } else {
        // For GET requests (optional, mostly for testing the endpoint)
        res.status(200).json({ message: "Razorpay API endpoint for EduSource. Send POST requests with 'action' in body." });
    }
};
