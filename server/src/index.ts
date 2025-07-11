
import express from "express";
import dotenv from "dotenv";
import cors from "cors"; 
import authRouter from './routes/auth'; 
import tasksRouter from "./routes/task";
import openaiRouter from "./routes/openAI";
import groqRouter from "./routes/groq";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000; 


const allowedOrigins = [
  'http://localhost:8080', 
  'https://personal-time-pal-agent.lovable.app',
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

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/tasks', tasksRouter);
app.use('/api/v1/openai',openaiRouter)
app.use("/api/v1/groq",groqRouter)

app.get('/', (req, res) => {
  res.status(200).json({ message: 'Welcome to the API! Auth service is running.' });
});

app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong on the server.', error: err.message });
});

app.listen(PORT, () => {
  console.log(`Server is live on http://localhost:${PORT}`);
});