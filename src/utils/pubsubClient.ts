// utils/pubsubClient.ts
import { PubSub } from '@google-cloud/pubsub';
import dotenv from 'dotenv';

dotenv.config();

export const pubsub = new PubSub({
  projectId: process.env.GCP_PROJECT_ID,
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS, 
});

