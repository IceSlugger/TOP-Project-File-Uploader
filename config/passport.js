const LocalStrategy = require("passport-local").Strategy;
const bcrypt = require("bcryptjs");

function initializePassport(passport, prisma) {
  passport.use(
    new LocalStrategy({ usernameField: "email" }, async (email, password, done) => {
      try {
        // 1. Find user by email
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
          console.log("Login failed: User not found");
          return done(null, false, { message: "No user found with that email." });
        }

        // 2. Compare hashed password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
          console.log("Login failed: Password mismatch");
          return done(null, false, { message: "Incorrect password." });
        }

        console.log("Login successful for:", user.email);
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    })
  );

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id, done) => {
    try {
      const user = await prisma.user.findUnique({ where: { id } });
      done(null, user);
    } catch (err) {
      done(err);
    }
  });
}

module.exports = initializePassport;