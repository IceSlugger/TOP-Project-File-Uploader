const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Create new folder
exports.createFolder = async (req, res, next) => {
  try {
    await prisma.folder.create({
      data: {
        name: req.body.name,
        userId: req.user.id,
      },
    });
    res.redirect("/");
  } catch (err) {
    next(err);
  }
};

// View single folder and its files
exports.getFolder = async (req, res, next) => {
  try {
    const folder = await prisma.folder.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: { files: true },
    });
    res.render("folder", { folder });
  } catch (err) {
    next(err);
  }
};