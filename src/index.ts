import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import authRouter from "./routes/auth";
import tasksRouter from "./routes/task";
import openaiRouter from "./routes/openAI";
// import groqRouter from "./routes/groq";
import { startReminderCron } from "./cron/scheduler";
import { userSocketMap } from "./sockets";
import telegramRouter from "./routes/newTelegram";
import { startReminderSubscriber, stopReminderSubscriber } from "./pubsub/subscriber";
import { Subscription } from "@google-cloud/pubsub";
import googleRouter from "./routes/google";
import notificationsRouter from "./routes/notifications";
import groupRouter from "./routes/group";
import calendarRouter from "./routes/calendar";
import meetingsRouter from "./routes/meetings";
import {  emailRouter } from "./routes/email";
import gmailRouter from "./routes/gmail";
import { createClient } from 'redis';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

const allowedOrigins = [
  "http://localhost:8080",
  "https://personal-time-pal-agent.lovable.app",
  "https://repo-buddy-love-helper.lovable.app"
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

app.use(express.json());

// Routes
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/tasks', tasksRouter);
app.use('/api/v1/openai', openaiRouter);
// app.use("/api/v1/groq", groqRouter);
app.use("/api/v1/telegram", telegramRouter)
app.use("/api/v1/google",googleRouter)
app.use("/api/v1/notifications",notificationsRouter)
app.use("/api/v1/group",groupRouter)
app.use("/api/v1/calendar",calendarRouter)
app.use("/api/v1/meetings",meetingsRouter)
app.use("/api/v1/gmail",gmailRouter)
app.use("/api/v1/emails",emailRouter)

app.get('/', (req, res) => {
  res.status(200).json({ message: 'Welcome to the API! Auth service is running.' });
});

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong on the server.', error: err.message });
});


// Fixed Redis connection with proper error handling
export const client = createClient({
  socket: {
    host: 'localhost',
    port: 6379,
  },
});

// Proper Redis connection handling
async function initRedis() {
  try {
    await client.connect();
    console.log('✅ Redis connected successfully');
  } catch (error) {
    console.error('❌ Redis connection failed:', error);
  }
}

client.on('error', (err :any) => {
  console.error('Redis Client Error', err);
});

client.on('connect', () => {
  console.log('Redis client connected');
});

// Initialize Redis connection
initRedis();

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

startReminderCron();

let subscription: Subscription;

io.on('connection', (socket) => {
  console.log(`✅ New socket connected: ${socket.id}`);
  
  socket.on('register', (userId: string) => {
    userSocketMap.set(userId, socket.id);
    console.log(`🧾 Mapped user ${userId} to socket ${socket.id}`);
  });
  
  socket.on('disconnect', () => {
    for (const [userId, id] of userSocketMap.entries()) {
      if (id === socket.id) {
        userSocketMap.delete(userId);
        console.log(`❌ Socket disconnected for user ${userId}`);
        break;
      }
    }
  });
});

// 📣 Start subscriber AFTER socket.io is set up
subscription = startReminderSubscriber(io, userSocketMap);

process.on('SIGINT', async () => {
  console.log('🛑 Shutting down gracefully...');
  
  try {
    if (subscription) {
      await stopReminderSubscriber(subscription);
    }
    
    httpServer.close(() => {
      console.log('✅ Server closed');
      process.exit(0);
    });
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...');
  
  try {
    if (subscription) {
      await stopReminderSubscriber(subscription);
    }
    
    httpServer.close(() => {
      console.log('✅ Server closed');
      process.exit(0);
    });
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
});

httpServer.listen(PORT, () => {
  console.log(`🚀 Server is live on http://localhost:${PORT}`);
});