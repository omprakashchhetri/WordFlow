require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { default: mongoose } = require("mongoose");
const User = require("./models/User");
const Post = require("./models/Post");
const connectDB = require("./db/Connect");
const bcrypt = require("bcryptjs");
const app = express();
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const multer = require("multer");

// middleware for file upload
const uploadMiddleware = multer({ dest: "uploads/" });
const fs = require("fs");
const salt = bcrypt.genSaltSync(10);
const secret = process.env.SECRET_KEY;

// middleware
app.use(cors({ credentials: true, origin: "http://localhost:3000" }));
app.use(express.json());
app.use(cookieParser());
app.use("/uploads", express.static(__dirname + "/uploads"));

// registration page route
app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  try {
    const userDoc = await User.create({
      username,
      password: bcrypt.hashSync(password, salt),
    });
    res.json(userDoc);
  } catch (e) {
    res.status(400).json(e);
  }
});

// login page route
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const userDoc = await User.findOne({ username });
    if (userDoc) {
      const passOk = bcrypt.compareSync(password, userDoc.password);
      if (passOk) {
        // logged in
        jwt.sign({ username, id: userDoc._id }, secret, {}, (err, token) => {
          if (err) throw err;
          res.cookie("token", token).json({
            id: userDoc._id,
            username,
          });
        });
      } else {
        res.status(400).json("Wrong credentials");
      }
    } else {
      res.status(400).json("User not found");
    }
  } catch (e) {
    res.status(500).json(e);
  }
});

// profile page routej
app.get("/profile", (req, res) => {
  const { token } = req.cookies;
  if (token) {
    jwt.verify(token, secret, {}, (err, info) => {
      if (err) {
        // to handle JWT verification error
        res.status(401).json({ error: "Invalid token" });
        console.error("JWT verification error:", err);
      } else {
        // Token is valid, proceed with the profile endpoint logic
        res.json(info);
      }
    });
  } else {
    // No token provided
    res.status(401).json({ error: "No token provided" });
  }
});

// logout page route
app.post("/logout", (req, res) => {
  res.cookie("token", "").json("ok");
});

const allowedImageTypes = [
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/png",
  "image/gif",
]; // Specify the allowed image mimetypes

app.post("/post", uploadMiddleware.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file found" });
    }

    const { originalname, path, mimetype } = req.file;
    const parts = originalname.split(".");
    const ext = parts[parts.length - 1];
    const newPath = path + "." + ext;
    fs.renameSync(path, newPath);

    if (!allowedImageTypes.includes(mimetype)) {
      // Checking if the uploaded file's mimetype is allowed
      fs.unlinkSync(newPath); // Delete the file
      return res
        .status(400)
        .json({ error: "Invalid file type. Only image files are allowed." });
    }

    const { token } = req.cookies;
    jwt.verify(token, secret, {}, async (err, info) => {
      if (err) {
        fs.unlinkSync(newPath); // Delete the file
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { title, summary, content } = req.body;
      const postDoc = await Post.create({
        title,
        summary,
        content,
        cover: newPath,
        author: info.id,
      });

      res.json(postDoc);
    });
  } catch (err) {
    next(err); // Passing the error to the error-handling middleware
    console.error("Error processing file:", error);

    // Cleanup uploaded file if it exists
    if (req.file && req.file.path) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({ error: "File upload failed." });
  }
});

app.put("/post", uploadMiddleware.single("file"), async (req, res) => {
  try {
    let newPath = null;
    if (req.file) {
      const { originalname, path, mimetype } = req.file;
      const parts = originalname.split(".");
      const ext = parts[parts.length - 1];
      newPath = path + "." + ext;

      if (!allowedImageTypes.includes(mimetype)) {
        // Checking if the uploaded file's mimetype is allowed
        fs.unlinkSync(path); // Delete the file
        return res
          .status(400)
          .json({ error: "Invalid file type. Only image files are allowed." });
      }

      fs.renameSync(path, newPath);
    }

    const { token } = req.cookies;
    jwt.verify(token, secret, {}, async (err, info) => {
      if (err) throw err;
      const { id, title, summary, content } = req.body;
      const postDoc = await Post.findById(id);
      const isAuthor =
        JSON.stringify(postDoc.author) === JSON.stringify(info.id);
      if (!isAuthor) {
        if (newPath) {
          fs.unlinkSync(newPath); // Deleteing the file if it was uploaded
        }
        return res.status(400).json("You are not the author");
      }
      await postDoc.updateOne({
        title,
        summary,
        content,
        cover: newPath ? newPath : postDoc.cover,
      });

      res.json(postDoc);
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// post route for after creating a post
app.get("/post", async (req, res) => {
  res.json(
    await Post.find().populate("author", ["username"]).sort({ createdAt: -1 })
    // .limit(5)
  );
});

// post view after clicking the post
app.get("/post/:id", async (req, res) => {
  const { id } = req.params;
  const postDoc = await Post.findById(id).populate("author", ["username"]);
  res.json(postDoc);
});

// delete a post
app.delete("/post/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const deletedPost = await Post.findByIdAndDelete(id);
    if (!deletedPost) {
      return res.status(404).json({ error: "Post not found" });
    }
    res.json({ message: "Post deleted successfully" });
  } catch (error) {
    console.error("Error deleting post:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

const port = process.env.PORT || 4000;

const start = async () => {
  try {
    await connectDB(process.env.MONGO_URI);
    mongoose.connection.on("error", (error) => {
      console.error("MongoDB connection error:", error);
    });

    // MongoDB connection success
    mongoose.connection.once("open", () => {
      console.log("Connected to MongoDB");
    });

    app.listen(port, console.log(`Server Started at Port ${port}...`));
  } catch (error) {
    console.log(error);
  }
};

start();
