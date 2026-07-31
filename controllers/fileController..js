const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Upload file route handler
exports.uploadFile = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).send("No file uploaded.");

    await prisma.file.create({
      data: {
        name: req.file.originalname,
        url: req.file.path, // Cloudinary URL
        size: req.file.size,
        userId: req.user.id,
        folderId: req.body.folderId || null,
      },
    });

    res.redirect(req.body.folderId ? `/folders/${req.body.folderId}` : "/");
  } catch (err) {
    next(err);
  }
};

// View file details
exports.getFileDetails = async (req, res, next) => {
  try {
    const file = await prisma.file.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    res.render("file-details", { file });
  } catch (err) {
    next(err);
  }
};