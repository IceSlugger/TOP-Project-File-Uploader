require("dotenv").config();
const express = require("express");
const path = require("path");
const session = require("express-session");
const passport = require("passport");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");
const { PrismaSessionStore } = require("@quixo3/prisma-session-store");
const initializePassport = require("./config/passport");

const app = express();

// PostgreSQL Connection Pool & Prisma 7 Driver Adapter
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// View Engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Multer Storage Setup (Local Storage in /uploads)
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + "-" + file.originalname);
  },
});
const upload = multer({ storage });

// Static Files (Serve /public and /uploads)
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Security Middleware (CSP)
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; script-src 'self' 'unsafe-inline';"
  );
  next();
});

// Body Parsing Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session Setup
app.use(
  session({
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
    secret: process.env.SESSION_SECRET || "supersecretkey",
    resave: false,
    saveUninitialized: false,
    store: new PrismaSessionStore(prisma, {
      checkPeriod: 2 * 60 * 1000,
      dbRecordIdIsSessionId: true,
    }),
  })
);

// Passport Setup
initializePassport(passport, prisma);
app.use(passport.initialize());
app.use(passport.session());

// Global User Variable
app.use((req, res, next) => {
  res.locals.currentUser = req.user;
  next();
});

// Auth Guard
const isAuth = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.redirect("/login");
};

// --- AUTH ROUTES ---

app.get("/login", (req, res) => {
  if (req.isAuthenticated()) return res.redirect("/");
  res.render("login");
});

app.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/",
    failureRedirect: "/login",
  })
);

app.get("/signup", (req, res) => {
  if (req.isAuthenticated()) return res.redirect("/");
  res.render("signup");
});

app.post("/signup", async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    await prisma.user.create({
      data: { name, email, password: hashedPassword },
    });
    res.redirect("/login");
  } catch (err) {
    next(err);
  }
});

app.get("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect("/login");
  });
});

// --- DASHBOARD & FOLDERS ---

app.get("/", isAuth, async (req, res, next) => {
  try {
    const folders = await prisma.folder.findMany({
      where: { userId: req.user.id },
      include: { files: true },
    });
    const rootFiles = await prisma.file.findMany({
      where: { userId: req.user.id, folderId: null },
    });
    res.render("index", { folders, files: rootFiles });
  } catch (err) {
    next(err);
  }
});

// Create Folder
app.post("/folders", isAuth, async (req, res, next) => {
  try {
    await prisma.folder.create({
      data: { name: req.body.name, userId: req.user.id },
    });
    res.redirect("/");
  } catch (err) {
    next(err);
  }
});

// View Folder
app.get("/folders/:id", isAuth, async (req, res, next) => {
  try {
    const folder = await prisma.folder.findFirst({
      where: { id: parseInt(req.params.id, 10), userId: req.user.id },
      include: { files: true },
    });
    if (!folder) return res.redirect("/");
    res.render("folder", { folder });
  } catch (err) {
    next(err);
  }
});

// Delete Folder
app.post("/folders/:id/delete", isAuth, async (req, res, next) => {
  try {
    await prisma.folder.delete({
      where: { id: parseInt(req.params.id, 10) },
    });
    res.redirect("/");
  } catch (err) {
    next(err);
  }
});

// --- FILE UPLOADS & DELETE ---

// Upload File
app.post("/upload", isAuth, upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.redirect("back");

    const folderId = req.body.folderId ? parseInt(req.body.folderId, 10) : null;
    const fileUrl = `/uploads/${req.file.filename}`;

    await prisma.file.create({
      data: {
        name: req.file.originalname,
        url: fileUrl,
        size: req.file.size,
        userId: req.user.id,
        folderId,
      },
    });
    res.redirect(folderId ? `/folders/${folderId}` : "/");
  } catch (err) {
    next(err);
  }
});

// Delete File
app.post("/files/:id/delete", isAuth, async (req, res, next) => {
  try {
    const fileId = parseInt(req.params.id, 10);

    // 1. Find the file first so we know which folder it belonged to
    const file = await prisma.file.findUnique({
      where: { id: fileId },
    });

    if (file && file.userId === req.user.id) {
      const folderId = file.folderId;

      // 2. Remove record from Database
      await prisma.file.delete({ where: { id: fileId } });

      // 3. Remove local file from disk
      const filePath = path.join(__dirname, file.url);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      // 4. Redirect explicitly to folder or home
      return res.redirect(folderId ? `/folders/${folderId}` : "/");
    }

    res.redirect("/");
  } catch (err) {
    next(err);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));