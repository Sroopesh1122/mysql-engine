require('dotenv').config();
const { Worker } = require('bullmq');
const Redis = require('ioredis');
const { executeJob } = require('./sandbox');

// Create Redis connection with required BullMQ settings
const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,    
  enableReadyCheck: false 
});


const worker = new Worker('mysql-jobs', async (job) => {
  console.log(`Worker ${process.pid} → Starting job ${job.id}`);

  const result = await executeJob(job.data);

  // Save result in Redis
  await redis.set(
    `result:${job.data.jobId}`,
    JSON.stringify({
      jobId: job.data.jobId,
      status: result.status,
      message: result.message,
      output: result.output,
      error: result.error,
      executionTimeMs: result.executionTimeMs,
      completedAt: new Date().toISOString()
    }),
    'EX', 7200
  );

  console.log(`✅ Job ${job.id} completed → ${result.status}`);
}, {
  connection: redis,
  concurrency: 1
});

worker.on('failed', (job, err) => {
  console.error(`❌ Job ${job?.id} failed:`, err.message);
});

console.log(`👷 MySQL Worker started (Local Mode)`);