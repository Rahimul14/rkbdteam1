const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Ensure database directory exists
const dbDir = path.join(__dirname, 'database');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

// Database setup
const db = new sqlite3.Database(path.join(dbDir, 'blood_donors.db'));

// Create tables
db.serialize(() => {
    // Donors table
    db.run(`CREATE TABLE IF NOT EXISTS donors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        firstName TEXT NOT NULL,
        lastName TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        dob TEXT NOT NULL,
        bloodType TEXT NOT NULL,
        gender TEXT NOT NULL,
        address TEXT NOT NULL,
        city TEXT NOT NULL,
        zipCode TEXT NOT NULL,
        nidNumber TEXT,
        nidVerified BOOLEAN DEFAULT 0,
        nidData TEXT,
        registrationDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'Active',
        registeredBy TEXT DEFAULT 'user'
    )`);

    // Admin users table
    db.run(`CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        email TEXT NOT NULL,
        name TEXT,
        role TEXT DEFAULT 'admin',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Blood inventory table
    db.run(`CREATE TABLE IF NOT EXISTS blood_inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bloodType TEXT UNIQUE NOT NULL,
        units INTEGER DEFAULT 0,
        lastUpdated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Blood requests table
    db.run(`CREATE TABLE IF NOT EXISTS blood_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patientName TEXT NOT NULL,
        bloodType TEXT NOT NULL,
        units INTEGER NOT NULL,
        hospital TEXT NOT NULL,
        contactPerson TEXT NOT NULL,
        contactPhone TEXT NOT NULL,
        urgency TEXT DEFAULT 'Normal',
        status TEXT DEFAULT 'Pending',
        requestDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        fulfilledDate TIMESTAMP,
        notes TEXT
    )`);

    // NID verification logs
    db.run(`CREATE TABLE IF NOT EXISTS nid_verification_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        donorId INTEGER NOT NULL,
        verifiedBy TEXT,
        verificationDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        nidNumber TEXT NOT NULL,
        FOREIGN KEY (donorId) REFERENCES donors(id)
    )`);

    // Insert default admin if not exists
    const defaultAdmin = {
        username: 'admin',
        password: 'admin123', // In production, use bcrypt for hashing
        email: 'admin@roktokona.org',
        name: 'সিস্টেম অ্যাডমিন'
    };

    db.get("SELECT * FROM admins WHERE username = ?", [defaultAdmin.username], (err, row) => {
        if (!row) {
            db.run(
                "INSERT INTO admins (username, password, email, name) VALUES (?, ?, ?, ?)",
                [defaultAdmin.username, defaultAdmin.password, defaultAdmin.email, defaultAdmin.name]
            );
            console.log("✅ ডিফল্ট অ্যাডমিন তৈরি করা হয়েছে");
        }
    });

    // Initialize blood inventory
    const bloodTypes = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'];
    bloodTypes.forEach(type => {
        db.run("INSERT OR IGNORE INTO blood_inventory (bloodType, units) VALUES (?, 0)", [type]);
    });

    console.log("✅ ডাটাবেস টেবিলগুলো তৈরি করা হয়েছে");
});

// ==================== API ROUTES ====================

// 1. Health Check
app.get('/api/health', (req, res) => {
    res.json({ 
        success: true, 
        message: 'সার্ভার চালু আছে', 
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// 2. Get all donors
app.get('/api/donors', (req, res) => {
    db.all("SELECT * FROM donors ORDER BY registrationDate DESC", (err, rows) => {
        if (err) {
            console.error('ডাটাবেস ত্রুটি:', err);
            res.status(500).json({ success: false, message: 'ডেটা লোড করতে সমস্যা হয়েছে' });
        } else {
            // Parse nidData JSON string
            const donors = rows.map(donor => ({
                ...donor,
                nidData: donor.nidData ? JSON.parse(donor.nidData) : null,
                registrationDate: new Date(donor.registrationDate).toLocaleDateString('bn-BD')
            }));
            res.json({ success: true, donors, count: donors.length });
        }
    });
});

// 3. Register new donor
app.post('/api/donors', (req, res) => {
    const {
        firstName, lastName, email, phone, dob, bloodType, gender,
        address, city, zipCode, nidNumber, registeredBy
    } = req.body;

    // Validation
    if (!firstName || !lastName || !email || !phone || !bloodType || !gender || !city) {
        return res.status(400).json({ 
            success: false, 
            message: 'দয়া করে সকল আবশ্যক তথ্য প্রদান করুন' 
        });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ 
            success: false, 
            message: 'সঠিক ইমেইল ঠিকানা দিন' 
        });
    }

    // Phone validation (Bangladeshi format)
    const phoneRegex = /^\+?880?\s?1[3-9]\d{8}$/;
    if (!phoneRegex.test(phone.replace(/\s/g, ''))) {
        return res.status(400).json({ 
            success: false, 
            message: 'সঠিক মোবাইল নম্বর দিন (বাংলাদেশি ফরম্যাট)' 
        });
    }

    // NID validation if provided
    if (nidNumber && !/^\d{17}$/.test(nidNumber)) {
        return res.status(400).json({ 
            success: false, 
            message: 'সঠিক ১৭ ডিজিটের NID নম্বর দিন' 
        });
    }

    const nidVerified = nidNumber ? 0 : 0;
    const nidData = null;

    const query = `
        INSERT INTO donors 
        (firstName, lastName, email, phone, dob, bloodType, gender, address, city, zipCode, nidNumber, nidVerified, nidData, registeredBy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
        firstName, lastName, email, phone, dob, bloodType, gender,
        address, city, zipCode, nidNumber, nidVerified, nidData, registeredBy || 'user'
    ];

    db.run(query, params, function(err) {
        if (err) {
            console.error('ডাটাবেস ত্রুটি:', err);
            res.status(500).json({ 
                success: false, 
                message: 'নিবন্ধন প্রক্রিয়ায় সমস্যা হয়েছে' 
            });
        } else {
            // Update blood inventory
            db.run(
                "UPDATE blood_inventory SET units = units + 1, lastUpdated = CURRENT_TIMESTAMP WHERE bloodType = ?",
                [bloodType],
                (updateErr) => {
                    if (updateErr) {
                        console.error("ইনভেন্টরি আপডেট ত্রুটি:", updateErr);
                    }
                }
            );

            res.json({ 
                success: true, 
                message: 'রক্তদাতা সফলভাবে নিবন্ধিত হয়েছে',
                donorId: this.lastID,
                nidStatus: nidNumber ? 'পেন্ডিং' : 'নেই'
            });
        }
    });
});

// Frontend handling (ensure your static files are served correctly)
app.use(express.static(path.join(__dirname, '../frontend')));

// Serve frontend for all other routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 সার্ভার চালু হয়েছে: http://localhost:${PORT}`);
    console.log(`📊 API এভেইলেবল: http://localhost:${PORT}/api`);
    console.log(`💾 ডাটাবেস লোকেশন: ${path.join(dbDir, 'blood_donors.db')}`);
});
