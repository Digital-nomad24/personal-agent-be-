// src/config/passport.ts
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import prisma from '../utils/prisma';
import dotenv from 'dotenv';

dotenv.config();

const GOOGLE_ID = process.env.GOOGLE_ID as string;
const GOOGLE_SECRET = process.env.GOOGLE_SECRET as string;

if (!GOOGLE_ID || !GOOGLE_SECRET) {
  console.error("CRITICAL ERROR: Google OAuth credentials are not defined in environment variables.");
  process.exit(1);
}

passport.use(
  new GoogleStrategy(
    {
      clientID: GOOGLE_ID,
      clientSecret: GOOGLE_SECRET,
      callbackURL: "http://localhost:8000/api/v1/auth/google/SignIn/callback",
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Check if user already exists with this Google ID
        let user = await prisma.user.findFirst({
          where: { googleId: profile.id },
        });

        if (user) {
          return done(null, user);
        }

        // Check if user exists with the same email (from local auth)
        user = await prisma.user.findUnique({
          where: { email: profile.emails?.[0]?.value },
        });

        if (user) {
          // Link Google account to existing user
          user = await prisma.user.update({
            where: { id: user.id },
            data: {
              googleId: profile.id,
              provider: 'google',
            },
          });
          return done(null, user);
        }

        // Create new user
        user = await prisma.user.create({
          data: {
            googleId: profile.id,
            email: profile.emails?.[0]?.value || '',
            name: profile.displayName || profile.name?.givenName || '',
            provider: 'google',
          },
        });

        return done(null, user);
      } catch (error) {
        console.error('Error in Google OAuth:', error);
        return done(error);
      }
    }
  )
);

passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, name: true, provider: true },
    });
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

export default passport;