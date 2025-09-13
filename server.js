require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Razorpay = require('razorpay');
const fs = require('fs');
const ExcelJS = require('exceljs');
const crypto = require('crypto');

const path = require('path');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware setup
app.use(cors()); // Enable Cross-Origin Resource Sharing
app.use(express.json()); // Parse JSON bodies (built-in)
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies (built-in)

// Serve static files (HTML, CSS, JS) from the project's root directory
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const DB_PATH = path.join(__dirname, 'users.json');
let users = [];

// Function to read users from the database file
function loadUsers() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const data = fs.readFileSync(DB_PATH, 'utf8');
      users = JSON.parse(data);
      console.log('Successfully loaded users from users.json');
    } else {
      // If the file doesn't exist, start with an empty array and create the file.
      fs.writeFileSync(DB_PATH, JSON.stringify([], null, 2));
      console.log('Created new users.json file.');
    }
  } catch (error) {
    console.error('Error loading or creating user database:', error);
    // If there's an error (e.g., corrupted file), start with a clean slate.
    users = [];
  }
}

// Function to save users to the database file
function saveUsers() {
  try {
    // Using null, 2 for pretty-printing the JSON file
    fs.writeFileSync(DB_PATH, JSON.stringify(users, null, 2));
  } catch (error) {
    console.error('Error saving users to database:', error);
  }
}

// Load users when the server starts
loadUsers();

// Initialize Razorpay
// Make sure you have RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in your .env file
if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  console.error("Razorpay key ID or key secret is missing. Please check your .env file.");
  process.exit(1); // Exit if keys are not found
}
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Endpoint to provide the Razorpay Key ID to the frontend.
app.get('/api/get-key', (req, res) => {
  res.json({ key: process.env.RAZORPAY_KEY_ID });
});

// POST /register
app.post('/register', (req, res) => {
  const { phoneNumber, password, invitationCode } = req.body;

  // Basic validation
  if (!phoneNumber || !password || !invitationCode) {
    return res.status(400).json({ message: 'All fields are required.' });
  }

  if (password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters long.' });
  }

  // Check if user already exists
  if (users.find(user => user.phoneNumber === phoneNumber)) {
    return res.status(409).json({ message: 'User with this phone number already exists.' });
  }

  // IMPORTANT: In a real application, ALWAYS hash passwords before storing them.
  // Libraries like bcrypt are perfect for this.
  const newUser = {
    id: users.length + 1,
    phoneNumber,
    password, // In a real app, this should be a hashed password
    invitationCode,
    balance: 0,
    hashrate: [], // New: To store purchased products
  };

  users.push(newUser);
  saveUsers(); // Persist the new user to the file
  console.log('New user registered:', newUser);
  console.log('All users:', users); // For debugging

  res.status(201).json({ message: 'User registered successfully! Please log in.' });
});

// POST /login
app.post('/login', (req, res) => {
  const { phoneNumber, password } = req.body;

  if (!phoneNumber || !password) {
    return res.status(400).json({ message: 'Phone number and password are required.' });
  }

  const user = users.find(u => u.phoneNumber === phoneNumber);

  // In a real app, you would compare the provided password with the stored hash.
  if (!user || user.password !== password) {
    return res.status(401).json({ message: 'Invalid phone number or password.' });
  }

  // On successful login, return user data so the frontend can store it.
  // This is a simple way to manage state without a full session/token system.
  res.status(200).json({
    message: 'Login successful!',
    // IMPORTANT: Do NOT send the password back to the client.
    user: { phoneNumber: user.phoneNumber, balance: user.balance }
  });
});

// POST /logout
app.post('/logout', (req, res) => {
  // For this simple example, we just confirm the logout.
  // In a real app with tokens, the client would delete its token.
  console.log('User logged out.');
  res.status(200).json({ message: 'Logout successful.' });
});

app.get('/api/get-hashrate', (req, res) => {
  const { phoneNumber } = req.query;

  if (!phoneNumber) {
    return res.status(400).json({ message: 'Phone number is required.' });
  }

  const user = users.find(u => u.phoneNumber === phoneNumber);

  if (!user) {
    return res.status(404).json({ message: 'User not found.' });
  }

  // Return the user's hashrate array.
  res.status(200).json({ hashrate: user.hashrate || [] });
});

// PUT /api/update-profile
app.put('/api/update-profile', (req, res) => {
  const { phoneNumber, currentPassword, newPassword } = req.body;

  // Basic validation
  if (!phoneNumber || !currentPassword || !newPassword) {
    return res.status(400).json({ message: 'All fields are required to update password.' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ message: 'New password must be at least 8 characters long.' });
  }

  const user = users.find(u => u.phoneNumber === phoneNumber);

  if (!user) {
    // This case should be rare if the user is logged in, but it's good practice to check.
    return res.status(404).json({ message: 'User not found.' });
  }

  // IMPORTANT: In a real application, you would use bcrypt.compare to check the password.
  if (user.password !== currentPassword) {
    return res.status(401).json({ message: 'Incorrect current password.' });
  }

  // Update the password
  // IMPORTANT: In a real app, you would hash the newPassword with bcrypt before saving.
  user.password = newPassword;
  saveUsers(); // Persist the change to the file

  res.status(200).json({ message: 'Password updated successfully!' });
});

// Product Purchase Route (using balance)
app.post('/api/buy-product', (req, res) => {
  const { phoneNumber, productData } = req.body;
  const numericPrice = Number(productData.price);

  if (!phoneNumber || !productData || !productData.price || isNaN(numericPrice) || numericPrice <= 0) {
    return res.status(400).json({ message: 'Valid phone number and product data are required.' });
  }

  const user = users.find(u => u.phoneNumber === phoneNumber);

  if (!user) {
    return res.status(404).json({ message: 'User not found.' });
  }

  if (user.balance < numericPrice) {
    return res.status(402).json({ message: 'Insufficient balance.' });
  }

  // Deduct price from balance
  user.balance -= numericPrice;
  // Add the purchased product to the user's hashrate array
  user.hashrate.push(productData);

  saveUsers(); // Persist the change

  console.log(`Purchase by ${phoneNumber} for ${numericPrice}. New balance: ${user.balance}`);
  res.status(200).json({ success: true, newBalance: user.balance });
});


// POST /create-order
app.post('/create-order', async (req, res) => {
  const { amount, currency, qrId, phoneNumber, notes } = req.body;

  if (!currency || !phoneNumber || amount == null) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Amount, currency, and phone number are all required.',
    });
  }

  const numericAmount = Number(amount);

  if (isNaN(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({
      error: 'Invalid Amount',
      message: 'A valid, positive amount is required.',
    });
  }

  // Handle notes from both product and recharge pages
  const orderNotes = notes || {};
  // Ensure phoneNumber is always in the notes for verification later.
  orderNotes.phoneNumber = phoneNumber;
  // If qrId is provided (from the recharge page), add it.
  if (qrId) {
    orderNotes.qrId = qrId;
  }

  const options = {
    amount: Math.round(numericAmount * 100), // amount in the smallest currency unit (e.g., paise for INR), rounded to the nearest integer
    currency: currency,
    receipt: `receipt_order_${new Date().getTime()}`,
    notes: orderNotes, // Use the correctly constructed notes object
  };

  try {
    const order = await razorpay.orders.create(options);
    console.log('Order created:', order);
    res.json(order);
  } catch (error) {
    // Log the full error for server-side debugging
    console.error('Error creating Razorpay order:', JSON.stringify(error, null, 2));

    // Provide detailed error feedback to the frontend
    if (error && error.error && error.error.description) {
      return res.status(error.statusCode || 400).json({
        error: 'Payment Gateway Error',
        message: error.error.description,
      });
    }

    // Fallback for other types of server errors
    res.status(500).json({ error: 'Server Error', message: 'An unexpected error occurred.' });
  }
});

// POST /verify-payment
app.post('/verify-payment', async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, productData } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ status: 'failure', message: 'Missing payment details.' });
  }

  const body = `${razorpay_order_id}|${razorpay_payment_id}`;

  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body.toString())
    .digest('hex');

  if (expectedSignature === razorpay_signature) {
    // Signature is valid. Now, update the user's balance on the server.
    try {
      // Fetch the order from Razorpay to get the notes (which contain our phoneNumber)
      const order = await razorpay.orders.fetch(razorpay_order_id);
      const phoneNumber = order.notes.phoneNumber;

      const user = users.find(u => u.phoneNumber === phoneNumber);
      if (user) {
        // Check if this is a product purchase or a simple recharge
        if (productData && order.notes.purchaseType === 'product') {
          // It's a product purchase. Add product to user's hashrate.
          user.hashrate.push(productData);
          saveUsers();
          console.log(`Product purchase successful for ${phoneNumber}. Product: ${productData.name}`);
          res.json({ status: 'success', message: 'Product purchased successfully.' });
        } else {
          // It's a balance recharge.
          const amountPaid = order.amount / 100; // amount is in smallest unit (paise)
          user.balance += amountPaid;
          saveUsers(); // Persist the updated balance to the file
          console.log(`Payment successful for ${phoneNumber}. New balance: ${user.balance}`);
          res.json({ status: 'success', orderId: razorpay_order_id, newBalance: user.balance });
        }
      } else {
        console.error(`User not found for phone number: ${phoneNumber} from order ${razorpay_order_id}`);
        res.status(404).json({ status: 'failure', message: 'User associated with order not found.' });
      }
    } catch (error) {
      console.error('Error fetching order or updating balance:', error);
      res.status(500).json({ status: 'failure', message: 'Could not update user balance.' });
    }
  } else {
    console.error('Payment verification failed: Invalid signature.');
    res.status(400).json({ status: 'failure', message: 'Invalid signature.' });
  }
});

// Data Export Route
app.get('/api/export-users', async (req, res) => {
  try {
    // The 'users' array is already loaded in memory.
    if (!users || users.length === 0) {
      return res.status(404).send('No user data to export.');
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Users');

    // Define columns for the Excel sheet.
    // Note: Passwords are intentionally excluded for security.
    worksheet.columns = [
      { header: 'ID', key: 'id', width: 10 },
      { header: 'Phone Number', key: 'phoneNumber', width: 20 },
      { header: 'Balance', key: 'balance', width: 15, style: { numFmt: '"₹"#,##0.00' } },
      { header: 'Invitation Code', key: 'invitationCode', width: 20 },
      { header: 'Purchased Products', key: 'hashrate', width: 50 },
    ];

    // Add a row for each user.
    users.forEach(user => {
      worksheet.addRow({
        id: user.id,
        phoneNumber: user.phoneNumber,
        balance: user.balance,
        invitationCode: user.invitationCode,
        // Convert the hashrate array of objects into a readable string of product names.
        hashrate: user.hashrate && user.hashrate.length > 0
          ? user.hashrate.map(product => product.name).join(', ')
          : 'None',
      });
    });

    // Style the header row to be bold.
    worksheet.getRow(1).font = { bold: true };

    // Set the response headers to prompt a file download.
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=future_world_users.xlsx');

    // Write the workbook to the response stream and end the response.
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Error exporting data to Excel:', error);
    res.status(500).send('An error occurred while generating the Excel file.');
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});