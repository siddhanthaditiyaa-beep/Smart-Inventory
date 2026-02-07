const express = require("express");
const mongoose = require("mongoose");
const fetch = require("node-fetch");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");

const mapSlotsToProducts = require("./slotProductMapper"); // future scope

const app = express();
app.use(express.json());
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

/* =========================
   SESSION STORE
========================= */
let sessions = {};

/* =========================
   IMAGE UPLOAD CONFIG
========================= */
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads"),
  filename: (req, file, cb) =>
    cb(null, Date.now() + path.extname(file.originalname))
});

const upload = multer({ storage });

/* =========================
   SCHEMAS
========================= */
const UserSchema = new mongoose.Schema({
  role: { type: String, default: "customer" },
  fname: String,
  lname: String,
  email: String,
  password: String
});

const ItemSchema = new mongoose.Schema({
  key: String,
  name: String,
  stock: Number,
  price: { type: Number, default: 0 }
});

const OrderSchema = new mongoose.Schema({
  cart: Object,
  customer: {
    fname: String,
    lname: String,
    email: String
  },
  items: [
    {
      key: String,
      name: String,
      price: Number,
      qty: Number,
      subtotal: Number
    }
  ],
  totalAmount: Number,
  paymentStatus: String,
  time: String
});

const LogSchema = new mongoose.Schema({
  type: String,
  item: String,
  stock: Number,
  time: String
});

const ShelfScanSchema = new mongoose.Schema({
  shelf_id: String,
  imagePath: String,
  total_slots: Number,
  occupied_slots: Number,
  empty_slots: Number,
  occupied_slot_numbers: Array,
  empty_slot_numbers: Array,
  present_products: Array,
  missing_products: Array,
  detectedAt: String
});

/* =========================
   MODELS
========================= */
const User = mongoose.model("User", UserSchema);
const Item = mongoose.model("Item", ItemSchema);
const Order = mongoose.model("Order", OrderSchema);
const Log = mongoose.model("Log", LogSchema);
const ShelfScan = mongoose.model("ShelfScan", ShelfScanSchema);

/* =========================
   INIT
========================= */
async function init() {
  if (!(await User.findOne({ role: "admin" }))) {
    await User.create({
      role: "admin",
      fname: "Store",
      lname: "Admin",
      email: "admin",
      password: "admin123"
    });
  }

  if ((await Item.countDocuments()) === 0) {
    await Item.insertMany([
      { key: "chocolates", name: "Chocolates", stock: 5, price: 20 },
      { key: "biscuits", name: "Biscuits", stock: 8, price: 10 },
      { key: "chips", name: "Chips", stock: 6, price: 15 },
      { key: "juice", name: "Juice", stock: 7, price: 25 },
      { key: "soft-drinks", name: "Soft Drinks", stock: 9, price: 30 },
      { key: "canned-food", name: "Canned Food", stock: 4, price: 40 },
      { key: "rice", name: "Rice", stock: 7, price: 50 },
      { key: "salt", name: "Salt", stock: 10, price: 5 }
    ]);
  }
}

/* =========================
   AUTH
========================= */
function auth(role) {
  return (req, res, next) => {
    const token = req.headers.authorization;
    const user = sessions[token];
    if (!user || (role && user.role !== role)) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    req.user = user;
    next();
  };
}

/* =========================
   SIGNUP / LOGIN / LOGOUT
========================= */
app.post("/signup", async (req, res) => {
  const { fname, lname, email, password } = req.body;
  if (await User.findOne({ email })) {
    return res.status(400).json({ message: "User exists" });
  }
  await User.create({ fname, lname, email, password });
  res.json({ message: "Account created" });
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ email: username, password });
  if (!user) return res.status(401).json({ message: "Invalid credentials" });

  const token = Date.now().toString();
  sessions[token] = user;
  res.json({ token, role: user.role });
});

app.post("/logout", (req, res) => {
  delete sessions[req.body.token];
  res.json({ message: "Logged out" });
});

/* =================================================
   🔍 MONITORING AGENT (RESTORED)
================================================= */
setInterval(async () => {
  const items = await Item.find();
  for (const item of items) {
    if (item.stock <= 3) {
      await Log.create({
        type: "monitoring",
        item: item.name,
        stock: item.stock,
        time: new Date().toLocaleString()
      });
    }
  }
}, 3000);

/* =================================================
   🤖 FORECASTING AGENT (AUTO RESTOCK RESTORED)
================================================= */
setInterval(async () => {
  const items = await Item.find();
  for (const item of items) {
    if (item.stock === 0) {
      await Item.updateOne({ key: item.key }, { $inc: { stock: 10 } });
      await Log.create({
        type: "forecasting",
        item: item.name,
        stock: 10,
        time: new Date().toLocaleString()
      });
    }
  }
}, 5000);

/* =========================
   SHOP
========================= */
app.get("/shop-items", auth("customer"), async (req, res) => {
  const items = await Item.find();
  const view = {};
  items.forEach(i => {
    view[i.key] = {
      name: i.name,
      stock: i.stock,
      price: i.price,
      canBuy: i.stock > 0,
      warning: i.stock <= 3 ? i.stock : null
    };
  });
  res.json(view);
});

/* =========================
   CHECKOUT
========================= */
app.post("/checkout", auth("customer"), async (req, res) => {
  const cart = req.body.cart;
  if (!cart || Object.keys(cart).length === 0) {
    return res.status(400).json({ message: "Cart is empty" });
  }

  const items = [];
  let totalAmount = 0;

  for (const key in cart) {
    const item = await Item.findOne({ key });
    if (!item) continue;

    const qty = Math.min(cart[key], item.stock);
    const subtotal = qty * item.price;

    items.push({
      key,
      name: item.name,
      price: item.price,
      qty,
      subtotal
    });

    totalAmount += subtotal;
    await Item.updateOne({ key }, { $inc: { stock: -qty } });
  }

  await Order.create({
    cart,
    customer: {
      fname: req.user.fname,
      lname: req.user.lname,
      email: req.user.email
    },
    items,
    totalAmount,
    paymentStatus: "PAID",
    time: new Date().toLocaleString()
  });

  res.json({ message: "Order placed successfully" });
});

/* =========================
   CUSTOMER ORDER HISTORY (PAID ONLY)
========================= */
app.get("/customer/orders", auth("customer"), async (req, res) => {
  const orders = await Order.find({
    "customer.email": req.user.email,
    paymentStatus: "PAID"
  }).sort({ _id: -1 });

  res.json(orders);
});

/* =========================
   SERVER START
========================= */
const PORT = process.env.PORT || 3000;

mongoose
  .connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log("✅ MongoDB connected");
    await init();
    app.listen(PORT, () =>
      console.log(`🚀 Server running on port ${PORT}`)
    );
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
