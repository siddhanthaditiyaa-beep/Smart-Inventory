const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");

const app = express();
app.use(express.json());
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

/* =========================
   SESSION STORE
========================= */
let sessions = {};

/* =========================
   MONITORING STATE (ANTI-SPAM)
========================= */
const lastMonitoredStock = {};

/* =========================
   UPLOADS
========================= */
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, "uploads"),
  filename: (_, file, cb) =>
    cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

/* =========================
   SCHEMAS
========================= */
const User = mongoose.model("User", new mongoose.Schema({
  role: { type: String, default: "customer" },
  fname: String,
  lname: String,
  email: String,
  password: String
}));

const Item = mongoose.model("Item", new mongoose.Schema({
  key: String,
  name: String,
  stock: Number,
  price: { type: Number, default: 0 }
}));

const Order = mongoose.model("Order", new mongoose.Schema({
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
}));

const Log = mongoose.model("Log", new mongoose.Schema({
  type: String,
  item: String,
  stock: Number,
  time: String
}));

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
   LOGIN / LOGOUT
========================= */
app.post("/login", async (req, res) => {
  const user = await User.findOne({
    email: req.body.username,
    password: req.body.password
  });

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
   🔍 MONITORING AGENT
========================= */
setInterval(async () => {
  const items = await Item.find();

  for (const i of items) {
    const prev = lastMonitoredStock[i.key];

    if ((prev === undefined || prev > 3) && i.stock <= 3 && i.stock > 0) {
      await Log.create({
        type: "monitoring",
        item: i.name,
        stock: i.stock,
        time: new Date().toLocaleString()
      });
    }

    lastMonitoredStock[i.key] = i.stock;
  }
}, 3000);

/* =========================
   🤖 FORECASTING AGENT
========================= */
setInterval(async () => {
  const items = await Item.find();

  for (const i of items) {
    if (i.stock === 0) {
      await Item.updateOne({ key: i.key }, { $inc: { stock: 10 } });

      await Log.create({
        type: "forecasting",
        item: i.name,
        stock: 10,
        time: new Date().toLocaleString()
      });

      lastMonitoredStock[i.key] = 10;
    }
  }
}, 5000);

/* =========================
   SHOP
========================= */
app.get("/shop-items", auth("customer"), async (_, res) => {
  const items = await Item.find();
  const out = {};

  items.forEach(i => {
    out[i.key] = {
      name: i.name,
      stock: i.stock,
      price: i.price,
      canBuy: i.stock > 0,
      warning: i.stock <= 3 ? i.stock : null
    };
  });

  res.json(out);
});

/* =========================
   CHECKOUT
========================= */
app.post("/checkout", auth("customer"), async (req, res) => {
  const cart = req.body.cart;
  let total = 0;
  const items = [];

  for (const key in cart) {
    const item = await Item.findOne({ key });
    const qty = Math.min(cart[key], item.stock);
    const subtotal = qty * item.price;

    await Item.updateOne({ key }, { $inc: { stock: -qty } });

    total += subtotal;
    items.push({ key, name: item.name, price: item.price, qty, subtotal });
  }

  await Order.create({
    cart,
    customer: {
      fname: req.user.fname,
      lname: req.user.lname,
      email: req.user.email
    },
    items,
    totalAmount: total,
    paymentStatus: "PAID",
    time: new Date().toLocaleString()
  });

  res.json({ message: "Order placed" });
});

/* =========================
   ADMIN ROUTES
========================= */
app.get("/admin-data", auth("admin"), async (_, res) => {
  res.json({
    inventory: await Item.find(),
    monitoring: await Log.find({ type: "monitoring" }).sort({ _id: -1 }),
    forecasting: await Log.find({ type: "forecasting" }).sort({ _id: -1 })
  });
});

app.get("/admin/orders", auth("admin"), async (_, res) =>
  res.json(await Order.find().sort({ _id: -1 }))
);

app.get("/admin/analytics", auth("admin"), async (_, res) => {
  const orders = await Order.find({ paymentStatus: "PAID" });
  let totalRevenue = 0;
  const map = {};

  orders.forEach(o => {
    totalRevenue += o.totalAmount;
    const d = o.time.split(",")[0];
    map[d] = (map[d] || 0) + o.totalAmount;
  });

  res.json({
    totalRevenue,
    totalOrders: orders.length,
    dailyRevenue: Object.keys(map).map(d => ({
      date: d,
      revenue: map[d]
    }))
  });
});

app.post("/admin/update-stock", auth("admin"), async (req, res) => {
  await Item.updateOne({ key: req.body.key }, { stock: req.body.stock });
  res.json({ ok: true });
});

app.post("/admin/update-price", auth("admin"), async (req, res) => {
  await Item.updateOne({ key: req.body.key }, { price: req.body.price });
  res.json({ ok: true });
});

app.post("/admin/add-item", auth("admin"), async (req, res) => {
  await Item.create({
    key: req.body.name.toLowerCase().replace(/\s+/g, "-"),
    name: req.body.name,
    stock: req.body.stock,
    price: req.body.price
  });
  res.json({ ok: true });
});

app.delete("/admin/delete-item/:key", auth("admin"), async (req, res) => {
  await Item.deleteOne({ key: req.params.key });
  res.json({ ok: true });
});

app.post("/admin/reset-logs", auth("admin"), async (_, res) => {
  await Log.deleteMany({});
  await Order.deleteMany({});
  res.json({ ok: true });
});

/* =========================
   SERVER START
========================= */
mongoose
  .connect(process.env.MONGODB_URI)
  .then(async () => {
    await init();
    app.listen(process.env.PORT || 3000);
    console.log("🚀 Server running");
  });
