import passport from 'passport';
import { Strategy as GoogleStrategy, Profile } from 'passport-google-oauth20';
import dotenv from 'dotenv';
import prisma from '../utils/prisma';

dotenv.config();

const GOOGLE_ID = process.env.GOOGLE_ID as string;
const GOOGLE_SECRET = process.env.GOOGLE_SECRET as string;

if (!GOOGLE_ID || !GOOGLE_SECRET) {
  console.error("CRITICAL ERROR: Google OAuth credentials are not defined.");
  process.exit(1);
}

// Configure the Google OAuth strategy
const googleStrategy = new GoogleStrategy(
  {
    clientID: GOOGLE_ID,
    clientSecret: GOOGLE_SECRET,
    callbackURL: "http://localhost:8000/api/v1/auth/google/SignIn/callback",
    scope: [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/gmail.readonly',  // ✅ Required to read emails
  'https://www.googleapis.com/auth/gmail.metadata',  // Optional, for metadata
  'https://www.googleapis.com/auth/gmail.modify'     // Optional, if you want to modify/read attachments
],
  },
  async (accessToken: string, refreshToken: string, profile: Profile, done) => {
    try {
      const googleId = profile.id;
      const email = profile.emails?.[0]?.value;
      const name = profile.displayName || profile.name?.givenName || '';

      if (!email) {
        return done(new Error("Email not found in Google profile"), false);
      }

      // Find by Google ID
      let user = await prisma.user.findUnique({ where: { googleId } });

      if (user) return done(null, user);

      // Find by email (local auth previously)
      user = await prisma.user.findUnique({ where: { email } });

      if (user) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            googleId,
            provider: 'google',
            googleAccessToken: accessToken,
            googleRefreshToken: refreshToken || user.googleRefreshToken, // only update if available
          },
        });
        return done(null, user);
      }

      // Create new user
      user = await prisma.user.create({
        data: {
          googleId,
          email,
          name,
          provider: 'google',
          googleAccessToken: accessToken,
          googleRefreshToken: refreshToken,
        },
      });

      return done(null, user);
    } catch (err) {
      console.error('[Google OAuth Error]', err);
      return done(err);
    }
  }
);

// Ensure refresh tokens are always returned
googleStrategy.authorizationParams = () => ({
  access_type: 'offline',
  prompt: 'consent',
});

passport.use(googleStrategy);

passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        provider: true,
      },
    });
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

export default passport;
