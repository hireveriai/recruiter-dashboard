const express = require("express");
const routes = require("./routes");
const errorHandler = require("./middlewares/error-handler");

const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "VerisNova Recruiter backend is healthy",
  });
});

app.use("/", routes);
app.use(errorHandler);

module.exports = app;
