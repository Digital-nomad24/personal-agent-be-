// src/routes/auth.ts
import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma';
import { signupInput, signinInput, SignupInput, SigninInput } from '../utils/zodSchema';
import { authMiddleware } from '../middleware/auth';
import passport from '../utils/passportLogic';
import dotenv from 'dotenv';

dotenv.config(); 

const authRouter = Router();
const JWT_SECRET = process.env.JWT_SECRET as string;
const SALT_ROUNDS = parseInt(process.env.SALT_ROUNDS || '10', 10);

if (!JWT_SECRET) {
  console.error("CRITICAL ERROR: JWT_SECRET is not defined in environment variables.");
  process.exit(1); 
}

export const generateToken = (userId: string) => {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '1h' });
};

authRouter.post('/signup', async (req: Request<{}, {}, SignupInput>, res: Response) => {
  try {
    const { email, name, password } = signupInput.parse(req.body);

    const existingUser = await prisma.user.findUnique({
      where: { email: email },
    });

    if (existingUser) {
      return res.status(409).json({ message: 'User with this email already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const newUser = await prisma.user.create({
      data: {
        email: email,
        name: name,
        password: hashedPassword,
        provider: 'local',
      },
      select: {
        id: true,
        email: true,
        name: true,
      }
    });

    const token = generateToken(newUser.id);

    res.status(201).json({
      message: 'User registered successfully!',
      token: token,
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
      },
    });

  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ message: 'Invalid input data', errors: error.errors });
    }
    console.error('Error during signup:', error);
    res.status(500).json({ message: 'Internal server error during signup.' });
  }
});

authRouter.post('/signin', async (req: Request<{}, {}, SigninInput>, res: Response) => {
  try {
    const { email, password } = signinInput.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email: email },
    });

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    // Check if user signed up with Google OAuth
    if (user.provider === 'google' && !user.password) {
      return res.status(401).json({ 
        message: 'This account was created with Google. Please use Google Sign-In.' 
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password!);

    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const token = generateToken(user.id);

    res.status(200).json({
      message: 'Signed in successfully!',
      token: token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });

  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ message: 'Invalid input data', errors: error.errors });
    }
    console.error('Error during signin:', error);
    res.status(500).json({ message: 'Internal server error during signin.' });
  }
});

authRouter.post('/signout', authMiddleware, (req: Request, res: Response) => {
  res.status(200).json({ message: 'Signed out successfully. Please discard your token.' });
});

authRouter.get('/profile', authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId;

    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, email: true, name: true, provider: true,calendarConnected:true }
        });

        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        res.status(200).json({ message: 'User profile retrieved successfully', user: user });
    } catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).json({ message: 'Internal server error.' });
    }
});

authRouter.get('/google', 
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

authRouter.get('/google/SignIn/callback',
  passport.authenticate('google', { session: false }),
  async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      console.log("GOOGLE SIGN IN")
      if (!user) {
        return res.redirect(`${process.env.CLIENT_URL}/login?error=auth_failed`);
      }

      const token = generateToken(user.id);

      console.log(token)
      res.redirect(`${process.env.CLIENT_URL}/auth/callback?token=${token}`);

    } catch (error) {
      console.error('Error in Google callback:', error);
      res.redirect(`${process.env.CLIENT_URL}/login?error=server_error`);
    }
  }
);

export default authRouter;