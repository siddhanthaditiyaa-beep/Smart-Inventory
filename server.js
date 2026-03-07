const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const { Parser } = require("json2csv"); // NEW (CSV export)
const mapSlotsToProducts = require("./slotProductMapper");

const app = express();
app.use(express.json());
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

function calculateDistance(lat1, lon1, lat2, lon2) {

  const R = 6371; // Earth radius km

  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;

  const a =
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
}

/* =========================
   SESSION STORE
========================= */
let sessions = {};

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

/* =========================
   STORE BRANCHES
========================= */

const Store = mongoose.model("Store", new mongoose.Schema({
  name: String,
  latitude: Number,
  longitude: Number,
  inventory: {
    chocolates: Number,
    biscuits: Number,
    chips: Number,
    juice: Number,
    "soft-drinks": Number,
    "canned-food": Number,
    rice: Number,
    salt: Number
  }
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

  /* =========================
   CREATE STORE BRANCHES
========================= */
if ((await Store.countDocuments()) === 0) {
  await Store.insertMany([
    {
      name: "Andheri Branch",
      latitude: 19.1197,
      longitude: 72.8468,
      inventory: {
        chocolates: 10,
        biscuits: 6,
        chips: 8,
        juice: 5
      }
    },
    {
      name: "Bandra Branch",
      latitude: 19.0596,
      longitude: 72.8295,
      inventory: {
        chocolates: 4,
        biscuits: 9,
        chips: 3,
        juice: 7
      }
    },
    {
      name: "Juhu Branch",
      latitude: 19.1075,
      longitude: 72.8263,
      inventory: {
        chocolates: 12,
        biscuits: 5,
        chips: 6,
        juice: 9
      }
    }
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
    if (i.stock <= 3 && i.stock > 0) {
      await Log.create({
        type: "monitoring",
        item: i.name,
        stock: i.stock,
        time: new Date().toLocaleString()
      });
    }
  }
}, 2000);

/* =========================
   🤖 FORECASTING AGENT (SMART RESTOCK DELAY)
========================= */

const pendingRestocks = {};

setInterval(async () => {

  const items = await Item.find();

  for (const i of items) {

    if (i.stock === 0 && !pendingRestocks[i.key]) {

      console.log("⚠️ Item out of stock:", i.name);

      pendingRestocks[i.key] = true;

      setTimeout(async () => {

        const latest = await Item.findOne({ key: i.key });

        // Only restock if still empty
        if (latest.stock === 0) {

          await Item.updateOne(
            { key: i.key },
            { $inc: { stock: 10 } }
          );

          await Log.create({
            type: "forecasting",
            item: i.name,
            stock: 10,
            time: new Date().toLocaleString()
          });

          console.log("🤖 AI Restocked:", i.name);

        }

        delete pendingRestocks[i.key];

      }, 5000); // 5 second delay

    }

  }

}, 2000);

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

    await Item.updateOne(
      { key },
      { $inc: { stock: -qty } }
    );

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

/* =========================
   📥 DOWNLOAD INVENTORY CSV
========================= */
app.get("/admin/download-csv", auth("admin"), async (_, res) => {
  const items = await Item.find();

  const data = items.map(i => ({
    Item: i.name,
    Stock: i.stock,
    Price: i.price
  }));

  const parser = new Parser();
  const csv = parser.parse(data);

  res.header("Content-Type", "text/csv");
  res.attachment("inventory.csv");
  res.send(csv);
});

/* =========================
   ADMIN ITEM MANAGEMENT
========================= */
app.post("/admin/update-stock", auth("admin"), async (req, res) => {
  await Item.updateOne(
    { key: req.body.key },
    { stock: req.body.stock }
  );
  res.json({ ok: true });
});

app.post("/admin/update-price", auth("admin"), async (req, res) => {
  await Item.updateOne(
    { key: req.body.key },
    { price: req.body.price }
  );
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

/* =========================
   RESET LOGS & STOCKS
========================= */
app.post("/admin/reset-logs", auth("admin"), async (_, res) => {
  await Log.deleteMany({});
  await Order.deleteMany({});

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
    await Item.updateOne(
      { key },
      { stock: defaults[key] }
    );
  }

  res.json({ ok: true });
});

/* =========================
   CUSTOMER ORDERS
========================= */
app.get("/customer/orders", auth("customer"), async (req, res) => {
  const orders = await Order.find({
    "customer.email": req.user.email
  }).sort({ _id: -1 });

  res.json(orders);
});

/* =========================
   PROCESS SHELF IMAGE (AI)
========================= */
app.post("/process-shelf", auth("admin"), upload.single("image"), async (req, res) => {

  try {

    const imagePath = `/uploads/${req.file.filename}`;

    // Send image to Python ML server
    const mlResponse = await fetch("http://127.0.0.1:5001/process-shelf-image", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        imagePath
      })
    });

    const mlData = await mlResponse.json();

    const mapped = mapSlotsToProducts(
      mlData.shelf_id,
      mlData.occupied_slot_numbers,
      mlData.empty_slot_numbers
    );

    // Reduce stock for missing products
    for (const product of mapped.missing_products) {

      await Item.updateOne(
        { key: product },
        { $inc: { stock: -1 } }
      );

      await Log.create({
        type: "monitoring",
        item: product,
        stock: 0,
        time: new Date().toLocaleString()
      });

    }

    res.json({
      message: "Shelf processed",
      present: mapped.present_products,
      missing: mapped.missing_products
    });

  } catch (err) {

    console.error(err);
    res.status(500).json({ error: "Shelf processing failed" });

  }

});

/* =========================
   FIND NEARBY STORES
========================= */

app.get("/nearby-stores/:key", auth("customer"), async (req, res) => {

  const key = req.params.key;

  const userLat = Number(req.query.lat);
  const userLon = Number(req.query.lon);

  const stores = await Store.find();

  const available = [];

  stores.forEach(store => {

    const stock = store.inventory[key];

    if (stock && stock > 0) {

      const distance = calculateDistance(
        userLat,
        userLon,
        store.latitude,
        store.longitude
      );

      available.push({
        store: store.name,
        stock,
        distance: distance.toFixed(2)
      });

    }

  });

  res.json(available);

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