import express from "express";

const port: number = 4000;
const app = express();

app.get("/health", (req, res) => {
    res.json({ status: "ok" });
});



app.listen(port);