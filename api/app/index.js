require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { Queue } = require('bullmq');
const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '100kb' }));

// Inside api/index.js — replace the redis creation part
const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false
});

const jobQueue = new Queue('mysql-jobs', { 
  connection: redis,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: {
    age: 3600,   // 1 hour (faster cleanup for judge systems)
    count: 1000  // keep only last 1000 jobs
  },

  removeOnFail: {
    age: 86400,  // 1 day
    count: 500
  }
  }
});


app.get("/health",async(req,res)=>{
  return res.json({
    status:"success",
    message:"Api is up and running"
  })
})

// Submit a new job
app.post('/execute', async (req, res) => {
  const { setup_code, user_query, expected_result } = req.body;

  if (!setup_code?.trim() || !user_query?.trim()) {
    return res.status(400).json({ 
      error: "setup_code and user_query are required" 
    });
  }

  const jobId = uuidv4();

  await jobQueue.add('execute-mysql', {
    jobId,
    setup_code: setup_code.trim(),
    user_query: user_query.trim(),
    expected_result: expected_result || null,
    timeoutMs: 12000
  });

  res.status(202).json({
    jobId,
    status: "queued",
    message: "Your SQL job has been submitted to the queue"
  });
});

// Get job result
app.get('/result/:jobId', async (req, res) => {
  const data = await redis.get(`result:${req.params.jobId}`);
  
  if (!data) {
    return res.status(404).json({ 
      error: "Result not found or job is still processing" 
    });
  }

  res.json(JSON.parse(data));
});

const PORT = process.env.API_PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 MySQL Judge API running on http://localhost:${PORT}`);
});