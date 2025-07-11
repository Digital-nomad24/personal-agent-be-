// src/routes/auth.ts
import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma';
import { signupInput, signinInput, SignupInput, SigninInput } from '../utils/zodSchema';
import { authMiddleware } from '../middleware/auth';
import dotenv from 'dotenv';

dotenv.config(); 

const authRouter = Router();
const JWT_SECRET = process.env.JWT_SECRET as string;
const SALT_ROUNDS = parseInt(process.env.SALT_ROUNDS || '10', 10);

if (!JWT_SECRET) {
  console.error("CRITICAL ERROR: JWT_SECRET is not defined in environment variables.");
  process.exit(1); 
}

authRouter.post('/signup', async (req: Request<{}, {}, SignupInput>, res: Response) => {
  try {
    const { email, name, password } = signupInput.parse(req.body);

    // Check if user with this email already exists
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
      },
      select: {
        id: true,
        email: true,
        name: true,
      }
    });

    const token = jwt.sign({ userId: newUser.id }, JWT_SECRET, { expiresIn: '1h' }); // Token expires in 1 hour

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

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1h' }); // Token expires in 1 hour

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

// --- SIGNOUT Route ---
// For stateless JWTs, server-side "signout" typically means telling the client
// to discard the token. The token will eventually expire. If a more robust
// solution (e.g., immediate invalidation) is needed, a token blacklist
// stored in a database/cache would be required, which adds complexity.
// For now, this just acknowledges the request.
authRouter.post('/signout', authMiddleware, (req: Request, res: Response) => {
  // Client-side: delete token from localStorage/cookies.
  // Server-side: Acknowledge the request. If a blacklist were implemented,
  // the token would be added to it here.
  res.status(200).json({ message: 'Signed out successfully. Please discard your token.' });
});

// Example of a protected route
authRouter.get('/profile', authMiddleware, async (req: Request, res: Response) => {
    // userId is available on req.userId thanks to authMiddleware
    const userId = (req as any).userId;

    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, email: true, name: true }
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


export default authRouter;