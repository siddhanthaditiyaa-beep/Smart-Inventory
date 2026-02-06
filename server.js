const express = require("express");
const mongoose = require("mongoose");
const fetch = require("node-fetch");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

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
   MONGODB
========================= */
mongoose
  .connect("mongodb://127.0.0.1:27017/smart_inventory")
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ Mongo error", err));

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
  stock: Number
});

const OrderSchema = new mongoose.Schema({
  cart: Object,
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
      { key: "chocolates", name: "Chocolates", stock: 5 },
      { key: "biscuits", name: "Biscuits", stock: 8 },
      { key: "chips", name: "Chips", stock: 6 },
      { key: "juice", name: "Juice", stock: 7 },
      { key: "soft-drinks", name: "Soft Drinks", stock: 9 },
      { key: "canned-food", name: "Canned Food", stock: 4 },
      { key: "rice", name: "Rice", stock: 7 },
      { key: "salt", name: "Salt", stock: 10 }
    ]);
  }
}
init();

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

/* =========================
   MONITORING & FORECASTING
========================= */
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
   SHOP & CHECKOUT
========================= */
app.get("/shop-items", auth("customer"), async (req, res) => {
  const items = await Item.find();
  const view = {};
  items.forEach(i => {
    view[i.key] = {
      name: i.name,
      stock: i.stock,
      canBuy: i.stock > 0,
      warning: i.stock <= 3 ? i.stock : null
    };
  });
  res.json(view);
});

app.post("/checkout", auth("customer"), async (req, res) => {
  const cart = req.body.cart;
  const adjusted = {};
  const notices = [];

  for (const key in cart) {
    const item = await Item.findOne({ key });
    if (!item) continue;

    const allowed = Math.min(cart[key], item.stock);
    adjusted[key] = allowed;

    if (cart[key] > item.stock) {
      notices.push(`${item.name}: only ${item.stock} available`);
    }

    await Item.updateOne({ key }, { $inc: { stock: -allowed } });
  }

  await Order.create({ cart: adjusted, time: new Date().toLocaleString() });
  res.json({ message: "Order placed", notices });
});

/* =========================
   ADMIN
========================= */
app.post("/admin/add-item", auth("admin"), async (req, res) => {
  const { name, stock } = req.body;
  const key = name.toLowerCase().replace(/\s+/g, "-");
  if (await Item.findOne({ key })) {
    return res.status(400).json({ message: "Item exists" });
  }
  await Item.create({ key, name, stock });
  res.json({ message: "Item added" });
});

app.delete("/admin/delete-item/:key", auth("admin"), async (req, res) => {
  await Item.deleteOne({ key: req.params.key });
  res.json({ message: "Item deleted" });
});

app.get("/admin-data", auth("admin"), async (req, res) => {
  const inventory = await Item.find();
  const monitoring = await Log.find({ type: "monitoring" }).sort({ _id: -1 });
  const forecasting = await Log.find({ type: "forecasting" }).sort({ _id: -1 });
  res.json({ inventory, monitoring, forecasting });
});

/* =========================
   🔁 RESET LOGS & STOCKS (FIXED)
========================= */
app.post("/admin/reset-logs", auth("admin"), async (req, res) => {
  try {
    await Log.deleteMany({});

    const defaults = {
      chocolates: 5,
      biscuits: 8,
      chips: 6,
      juice: 7,
      "soft-drinks": 9,
      "canned-food": 4,
      rice: 7,
      salt: 10
    };

    for (const key in defaults) {
      await Item.updateOne({ key }, { $set: { stock: defaults[key] } });
    }

    res.json({ message: "Logs and stocks reset successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   SERVER
========================= */
app.listen(3000, () => {
  console.log("🚀 Server running at http://localhost:3000");
});
