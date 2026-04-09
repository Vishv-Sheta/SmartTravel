const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");
const bcrypt = require("bcryptjs");
const jwt = require('jsonwebtoken');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const fs = require('fs');
require('dotenv').config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const upload = multer({ dest: 'uploads/' });

const app = express();
const port = 4000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

const secretKey = process.env.JWT_SECRET

const db = mysql.createConnection({
  host: process.env.HOST,
  user: process.env.USER,
  password: process.env.PASSWORD,
  database: process.env.DATABASE
});

db.connect((err) => {
  if (err) {
    console.error("Error connecting to MySQL:", err);
    return;
  }
  console.log("MySQL connected");
});

const crypto = require('crypto');

app.get("/api/generate-token", (req, res) => {
    const email = req.query.email;
    const token = crypto.randomBytes(4).toString('hex').toUpperCase();
    const expiry = Date.now() + 300000;

    db.query("UPDATE users SET reset_token = ?, token_expiry = ? WHERE email = ?", [token, expiry, email], () => {
        console.log(`Token for changing password for account ${email} is ${token}`);
        res.send("Secure token generated. Check the Server Console!");
    });
});

app.post("/api/reset-secure", async (req, res) => {
    const { token, password } = req.body;

    db.query("SELECT * FROM users WHERE reset_token = ? AND token_expiry > ?", [token, Date.now()], async (err, results) => {
        if (results.length === 0) {
            return res.status(403).send("RESOLUTION ACTIVE: Reset denied. Token is missing or invalid.");
        }

        const hashedPass = await bcrypt.hash(password, 10);
        db.query("UPDATE users SET password = ?, reset_token = NULL WHERE id = ?", [hashedPass, results[0].id], () => {
            res.send("SUCCESS: Password updated securely using token verification.");
        });
    });
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  const query = "SELECT * FROM users WHERE email = ?";
  db.query(query, [email], async (err, results) => {
    if (err) {
      console.error('Login query failed:', err);
      return res.status(401).json({ success: false, message: "Database Error" });
    }

    if (results.length === 0) {
      return res.status(401).json({ success: false, message: "User not found" })
    }

    const user = results[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ success: false, message: "Incorrect password" });
    }

    const token = jwt.sign({ id: user.id }, secretKey, { expiresIn: "1h" });
    res.json({ success: true, token });
  });
});

app.post("/api/register", async (req, res) => {
  const { name, email, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);

  const checkQuery = "SELECT id FROM users WHERE email = ?";
  db.query(checkQuery, [email], (err, results) => {
    if (err) return res.status(500).json({ success: false, message: "Server error" });
    if (results.length > 0) return res.status(409).json({ success: false, message: "Email already registered" });

    const insertQuery = "INSERT INTO users (name, email, password) VALUES (?, ?, ?)";
    db.query(insertQuery, [name, email, hashedPassword], (err) => {
      if (err) return res.status(500).json({ success: false, message: "Registration failed" });
      res.json({ success: true, message: "User registered" });
    });
  });
});

app.get("/routes", (req, res) => {
  const { from, to, mode } = req.query;
  console.log("Searching routes: ", from, " -> ", to, " Mode: ", mode);
  
  let queryStr = "SELECT * FROM routes";
  let queryParams = [];
  if(from || to || mode) queryStr += " WHERE"
  if (from) {
    queryStr += " LOWER(fromloc) = LOWER(?)"
    queryParams.push(from);
  }
  
  if (to) {
    if(from) queryStr += " AND"
    queryStr += " LOWER(toloc) = LOWER(?)"
    queryParams.push(to);
  }

  if (mode) {
    if(from || to) queryStr += " AND"
    queryStr += " LOWER(MODE) = LOWER(?)";
    queryParams.push(mode);
  }
  queryStr += " ORDER BY MODE;"
  
  db.query(queryStr, queryParams, (err, results) => {
    if (err) {
      console.error("Error fetching routes:", err);
      res.status(500).json({ error: "Database error" });
    } else {
      res.json(results);
    }
  });
});

app.get("/api/routes/:id", (req, res) => {
  const routeId = req.params.id;
  db.query("SELECT * FROM routes WHERE id = ?", [routeId], (err, results) => {
    if (err) return res.status(500).json({ success: false, message: "Database Error" });
    if (results.length === 0) return res.status(404).json({ success: false, message: "Route not found" });
    res.json({ success: true, route: results[0] });
  });
});

app.get("/api/ai/recommendations", (req, res) => {
  db.query("SELECT * FROM routes LIMIT 6", (err, results) => {
      if(err) {
          return res.status(500).json({ success: false, error: "Database error" });
      }
      const aiPicks = results.map(route => ({
          id: route.id,
          destination: route.toloc,
          image: route.image_url || null,
          tag: "Top Data Pick",
          price: route.price || 0
      }));
      res.json({ success: true, picks: aiPicks });
  });
});

app.post('/bookings', (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ success: false, message: 'No token provided' });

  jwt.verify(token, secretKey, (err, decoded) => {
    if (err) return res.status(403).json({ success: false, message: 'Invalid token' });

    const userId = decoded.id;
    const { routeId, cardNumber } = req.body;
    
    db.query("SELECT * FROM routes WHERE id = ?", [routeId], (err, results) => {
      if (err) return res.status(500).json({ success: false, message: "Database error" });
      if (results.length === 0) return res.status(404).json({ success: false, message: "Route not found or unavailable" });

      const route = results[0];

      const sql = `
        INSERT INTO bookings (usrId, fromloc, toloc, MODE, operator, deptime, arrtime, price)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;

      db.query(sql, [
        userId, 
        route.fromloc, 
        route.toloc, 
        route.MODE, 
        route.operator, 
        route.deptime, 
        route.arrtime, 
        route.price
      ], (err, result) => {
        if (err) {
          console.error('Database error on booking:', err);
          return res.status(500).json({ success: false, message: 'Booking failed' });
        }

        setTimeout(() => {
          res.json({ 
            success: true, 
            message: 'Booking successful', 
            bookingId: result.insertId,
            transactionId: "TXN-" + crypto.randomBytes(6).toString('hex').toUpperCase()
          });
        }, 1500);
      });
    });
  });
});

app.put("/api/user/update", async (req, res) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.json({ success: false, message: "Session Expired.." });
  }

  jwt.verify(token, secretKey, async (err, decoded) => {
    if (err) {
      return res.json({ success: false, message: "Invalid token" });
    }

    const userId = decoded.id;
    const { name, email, password } = req.body;

    try{
      let fields = [];
      let values = [];

      if(name){
        fields.push("name = ?");
        values.push(name);
      }
      if (email) {
        fields.push("email = ?");
        values.push(email);
      }
      if(password){
        const hashedPass = await bcrypt.hash(password, 10);
        fields.push("password = ?");
        values.push(hashedPass);
      }

      if(fields.length === 0){
        return res.status(400).json({success: false, message: "No Fields to update"});
      }

      values.push(userId);
      const qry = `UPDATE users SET ${fields.join(", ")} WHERE id = ?`;

      db.query(qry, values, (err, result) => {
        if(err){
          console.error("Update error: ", err);
          return res.status(500).json({success: false, message: "Update failed"});
        }
        if (result.affectedRows === 0) {
          return res.status(404).json({ success: false, message: "User not found" });
        }
        res.json({success: true, message: "Profile updated successfully"});
      });
    }catch(error){
      console.error("Update exception:", error);
      return res.status(500).json({success: false, message: "Server error"});
    }
  });
});

app.get('/api/user/me', (req, res) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'No token' });

  jwt.verify(token, secretKey, (err, decoded) => {
    if (err) return res.status(403).json({ success: false, message: 'Invalid token' });

    db.query("SELECT id, name, email FROM users WHERE id = ?", [decoded.id], (err, results) => {
      if (err) return res.status(500).json({ success: false, message: "DB error" });
      res.json(results[0]);
    });
  });
});


app.get('/api/admin/bookings', (req, res) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'No token' });

  jwt.verify(token, secretKey, (err, decoded) => {
    if (err) return res.status(403).json({ success: false, message: 'Invalid token' });

    db.query("SELECT * FROM bookings", (err, results) => {
      res.json(results);
    });
  });
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

app.post('/api/admin/upload-image', upload.single('image'), async (req, res) => {
  const { routeId } = req.body;
  try {
      if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
      
      const result = await cloudinary.uploader.upload(req.file.path, {
          folder: "auratravel_routes",
          quality: "auto",
          fetch_format: "auto"
      });
      fs.unlinkSync(req.file.path);
      
      db.query("UPDATE routes SET image_url = ? WHERE id = ?", [result.secure_url, routeId], (err, dbRes) => {
          if (err) {
              console.error("DB update failed:", err);
              return res.status(500).json({ error: "Failed to link Image to Route in DB (Does column image_url exist?)" });
          }
          if (dbRes.affectedRows === 0) {
               return res.status(404).json({ error: "Route ID not found!" });
          }
          res.json({ success: true, imageUrl: result.secure_url });
      });
      
  } catch(err) {
      console.error("Cloudinary failure:", err);
      res.status(500).json({ error: "Cloudinary external upload failed" });
  }
});
